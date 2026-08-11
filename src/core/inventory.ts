import type { ResolvedPaths } from './paths';
import {
  type ManifestEntry,
  type RawProfile,
  ParseError,
  parseExtensionFolderName,
  parseExtensionsManifest,
  parseObsolete,
  parseProfileRegistry,
} from './parsers';
import type { DiskVersion, ExtensionRecord, Inventory, ParseWarning, Profile } from './types';

export interface ComposeInput {
  rawProfiles: RawProfile[];
  defaultManifest: ManifestEntry[] | Error;
  /** keyed by RawProfile.location; Error = unreadable/unparsable */
  profileManifests: Map<string, ManifestEntry[] | Error>;
  diskFolders: string[];
  obsoleteFolderNames: string[];
  displayNames: Map<string, string>;
  /** extension id -> absolute icon fsPath, from the first disk version folder that has one */
  iconFsPaths?: Map<string, string>;
  /** extension id -> package.json description, from the first disk version folder whose
   *  package.json carries one (each field is resolved independently, like displayNames) */
  descriptions?: Map<string, string>;
  /** extension id -> package.json publisher, from the first disk version folder whose
   *  package.json carries one (each field is resolved independently, like displayNames) */
  publishers?: Map<string, string>;
  extensionsDir: string;
  /**
   * Set when orphan knowledge is unreliable for reasons compose cannot see itself
   * (e.g. a corrupt .obsolete file). Suppresses disk-only records instead of guessing orphans.
   */
  orphanKnowledgeUnreliable?: boolean;
}

export function composeInventory(input: ComposeInput): Inventory {
  const warnings: ParseWarning[] = [];

  const profiles: Profile[] = [
    { id: 'default', name: 'Default', isDefault: true, inheritsDefaultExtensions: false },
    ...input.rawProfiles.map((p) => ({
      id: p.location,
      name: p.name,
      isDefault: false,
      inheritsDefaultExtensions: p.inheritsDefaultExtensions,
    })),
  ];

  const defaultEntries = input.defaultManifest instanceof Error ? [] : input.defaultManifest;
  if (input.defaultManifest instanceof Error) {
    warnings.push({
      file: 'extensions.json (default profile)',
      message: input.defaultManifest.message,
      affectedProfileIds: ['default'],
    });
  }

  // extension id -> set of profile ids
  const membership = new Map<string, Set<string>>();
  const profileVersions = new Map<string, Map<string, string>>();
  const appScoped = new Set<string>();
  const appScopedEntries = new Map<string, ManifestEntry>();
  const add = (entry: ManifestEntry, profileId: string) => {
    let set = membership.get(entry.id);
    if (!set) membership.set(entry.id, (set = new Set()));
    set.add(profileId);
    let versions = profileVersions.get(entry.id);
    if (!versions) profileVersions.set(entry.id, (versions = new Map()));
    if (!versions.has(profileId)) versions.set(profileId, entry.version);
  };

  // Metadata extras (publisherDisplayName/installedTimestamp) come from the first manifest entry
  // for a given id that actually carries each field — default manifest first, then profile
  // manifests in registry order — tracked independently per field since not every entry for an
  // id necessarily carries both.
  const publisherDisplayNames = new Map<string, string>();
  const installedTimestamps = new Map<string, number>();
  const noteExtras = (e: ManifestEntry) => {
    if (e.publisherDisplayName !== undefined && !publisherDisplayNames.has(e.id)) {
      publisherDisplayNames.set(e.id, e.publisherDisplayName);
    }
    if (e.installedTimestamp !== undefined && !installedTimestamps.has(e.id)) {
      installedTimestamps.set(e.id, e.installedTimestamp);
    }
  };

  const inheritingIds = profiles.filter((p) => p.inheritsDefaultExtensions).map((p) => p.id);
  for (const e of defaultEntries) {
    add(e, 'default');
    for (const pid of inheritingIds) add(e, pid);
    if (e.isApplicationScoped) {
      appScoped.add(e.id);
      if (!appScopedEntries.has(e.id)) appScopedEntries.set(e.id, e);
    }
    noteExtras(e);
  }

  for (const p of input.rawProfiles) {
    if (p.inheritsDefaultExtensions) continue;
    const manifest = input.profileManifests.get(p.location);
    if (manifest instanceof Error) {
      warnings.push({
        file: `profiles/${p.location}/extensions.json`,
        message: manifest.message,
        affectedProfileIds: [p.location],
      });
      continue;
    }
    for (const e of manifest ?? []) {
      add(e, p.location);
      if (e.isApplicationScoped) {
        appScoped.add(e.id);
        if (!appScopedEntries.has(e.id)) appScopedEntries.set(e.id, e);
      }
      noteExtras(e);
    }
  }

  // App-scoped extensions are active in every profile.
  for (const id of appScoped) {
    const entry = appScopedEntries.get(id);
    if (entry) for (const p of profiles) add(entry, p.id);
  }

  // Disk folders -> versions per id (skip obsolete).
  const obsolete = new Set(input.obsoleteFolderNames);
  const versionsById = new Map<string, DiskVersion[]>();
  for (const folderName of input.diskFolders) {
    if (obsolete.has(folderName)) continue;
    const parsed = parseExtensionFolderName(folderName);
    if (!parsed) continue;
    let list = versionsById.get(parsed.id);
    if (!list) versionsById.set(parsed.id, (list = []));
    list.push({
      version: parsed.version,
      folderName,
      fsPath: `${input.extensionsDir}/${folderName}`.replaceAll('/', sep(input.extensionsDir)),
    });
  }

  // When any manifest is unreadable (default or per-profile), or the caller flagged orphan
  // knowledge as unreliable (e.g. a corrupt .obsolete file), disk-only ids are indistinguishable
  // from extensions belonging to the unreadable data — a corrupt default manifest also hides
  // isApplicationScoped flags, so an app-scoped extension could surface as a false orphan.
  // Suppress ALL disk-only records registry-wide rather than guess.
  const orphanKnowledgeUnreliable =
    input.orphanKnowledgeUnreliable === true ||
    input.defaultManifest instanceof Error ||
    input.rawProfiles.some((p) => input.profileManifests.get(p.location) instanceof Error);

  const allIds = new Set([...membership.keys(), ...versionsById.keys()]);
  const extensions: ExtensionRecord[] = [...allIds]
    .filter((id) => !orphanKnowledgeUnreliable || membership.has(id))
    .map((id) => {
      const installedIn = profiles.map((p) => p.id).filter((pid) => membership.get(id)?.has(pid));
      const isAppScoped = appScoped.has(id);
      const iconFsPath = input.iconFsPaths?.get(id);
      const description = input.descriptions?.get(id);
      const publisher = input.publishers?.get(id);
      const publisherDisplayName = publisherDisplayNames.get(id);
      const installedTimestampMs = installedTimestamps.get(id);
      const selectedVersions = profiles.flatMap((profile) => {
        const version = profileVersions.get(id)?.get(profile.id);
        return version ? [{ profileId: profile.id, version }] : [];
      });
      return {
        id,
        displayName: input.displayNames.get(id) ?? id,
        versions: versionsById.get(id) ?? [],
        ...(selectedVersions.length > 0 ? { profileVersions: selectedVersions } : {}),
        applyToAllProfiles: isAppScoped,
        installedIn,
        orphaned: installedIn.length === 0 && !isAppScoped,
        ...(iconFsPath !== undefined ? { iconFsPath } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(publisher !== undefined ? { publisher } : {}),
        ...(publisherDisplayName !== undefined ? { publisherDisplayName } : {}),
        ...(installedTimestampMs !== undefined ? { installedTimestampMs } : {}),
      };
    });
  extensions.sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));

  return { profiles, extensions, warnings };
}

function sep(referencePath: string): string {
  return referencePath.includes('\\') ? '\\' : '/';
}

/**
 * Defense in depth for package.json `icon` values, which are attacker-controlled data from an
 * installed extension's folder: only a plain relative path inside the extension folder is
 * accepted. Absolute paths (leading slash/backslash or a Windows drive letter) and any `..`
 * segment are rejected — the record then simply has no iconFsPath and the webview falls back to
 * its letter tile. The webview's localResourceRoots already contains icon loading; this makes the
 * containment explicit at compose time instead of relying on that enforcement alone.
 */
function isSafeIconRelPath(icon: string): boolean {
  if (icon.startsWith('/') || icon.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(icon)) return false;
  return !icon.split(/[/\\]/).includes('..');
}

/** Profile ids where the extension is directly installed (excludes profiles that only inherit it). */
export function directInstallProfileIds(inventory: Inventory, extId: string): string[] {
  const ext = inventory.extensions.find((e) => e.id === extId);
  if (!ext) return [];
  const nonInheriting = new Set(
    inventory.profiles.filter((p) => !p.inheritsDefaultExtensions).map((p) => p.id),
  );
  return ext.installedIn.filter((pid) => nonInheriting.has(pid));
}

/**
 * Profiles "Install in all profiles" should target: non-inheriting (inheriting profiles can't
 * hold a direct install), not disabled by a parse warning, and not already installed.
 * App-scoped extensions (applyToAllProfiles) are never targeted: they are already active in
 * every profile via VS Code's native flag, so per-profile CLI installs are meaningless.
 */
export function installEverywhereTargets(inventory: Inventory, extId: string): Profile[] {
  const ext = inventory.extensions.find((e) => e.id === extId);
  if (!ext || ext.applyToAllProfiles) return [];
  const disabledIds = new Set(inventory.warnings.flatMap((w) => w.affectedProfileIds));
  return inventory.profiles.filter(
    (p) => !p.inheritsDefaultExtensions && !disabledIds.has(p.id) && !ext.installedIn.includes(p.id),
  );
}

/**
 * Profiles "Remove from all profiles" should target: every profile the extension is directly
 * installed in (see directInstallProfileIds), minus any disabled by a parse warning.
 * App-scoped extensions are never targeted: composeInventory propagates their id into every
 * profile's installedIn, so directInstallProfileIds cannot distinguish real per-profile installs
 * from app-scope propagation — per-profile `--uninstall-extension` calls would act on installs
 * that don't exist per-profile. VS Code's native flag is the correct affordance for them.
 */
export function removeEverywhereTargets(inventory: Inventory, extId: string): Profile[] {
  const ext = inventory.extensions.find((e) => e.id === extId);
  if (!ext || ext.applyToAllProfiles) return [];
  const disabledIds = new Set(inventory.warnings.flatMap((w) => w.affectedProfileIds));
  const direct = new Set(directInstallProfileIds(inventory, extId).filter((pid) => !disabledIds.has(pid)));
  return inventory.profiles.filter((p) => direct.has(p.id));
}

/**
 * Per-profile "N direct + M shared" counts for the sidebar dashboard.
 * - direct: extensions from the profile's own manifest — i.e. non-app-scoped extensions whose
 *   `installedIn` includes this profile id. The default profile's own manifest entries land in
 *   `installedIn` under the 'default' id; a non-inheriting named profile's own entries land under
 *   its own id (see composeInventory). Inheriting profiles own no manifest, so direct is always 0.
 * - shared: app-scoped extensions, which composeInventory propagates into every profile's
 *   `installedIn` regardless of manifest ownership — "shared" here means "not from this profile's
 *   own file". Inheriting profiles additionally share the default profile's direct extensions
 *   (the ones they inherit), so their shared count adds the default profile's direct count.
 */
export function profileExtensionCounts(inventory: Inventory): Map<string, { direct: number; shared: number }> {
  const directCount = (profileId: string): number =>
    inventory.extensions.filter((e) => !e.applyToAllProfiles && e.installedIn.includes(profileId)).length;
  const appScopedCount = inventory.extensions.filter((e) => e.applyToAllProfiles).length;
  const defaultDirect = directCount('default');

  const result = new Map<string, { direct: number; shared: number }>();
  for (const p of inventory.profiles) {
    result.set(
      p.id,
      p.inheritsDefaultExtensions
        ? { direct: 0, shared: appScopedCount + defaultDirect }
        : { direct: directCount(p.id), shared: appScopedCount },
    );
  }
  return result;
}

/**
 * Absolute fsPath of a profile's own extensions.json — the global manifest for the default
 * profile, `<profilesDir>/<location>/extensions.json` for a named one. Undefined for a profile
 * that inherits the default profile's extensions: it has no file of its own to open or edit.
 */
export function profileManifestPath(paths: ResolvedPaths, profile: Profile): string | undefined {
  if (profile.inheritsDefaultExtensions) return undefined;
  if (profile.isDefault) return paths.globalExtensionsJson;
  const join = (a: string, b: string) => (a.includes('\\') ? `${a}\\${b}` : `${a}/${b}`);
  return join(join(paths.profilesDir, profile.id), 'extensions.json');
}

// ---------- IO wrapper ----------

export interface InventoryIo {
  /**
   * undefined when the file does not exist; an Error when it exists but could not be read
   * (e.g. EPERM/EACCES on a locked file) — the two are not interchangeable: "missing" degrades
   * into the usual empty/absent handling, while "unreadable" must not be silently treated as
   * missing, since that would misclassify extensions belonging to the unreadable file as
   * orphans (see getInventory's orphanKnowledgeUnreliable wiring).
   */
  readFile(p: string): Promise<string | undefined | Error>;
  listDirs(p: string): Promise<string[]>;
  /** best-effort displayName/icon/description/publisher from <folder>/package.json; undefined
   *  when unreadable */
  readPackageMeta(
    extFolderPath: string,
  ): Promise<{ displayName?: string; icon?: string; description?: string; publisher?: string } | undefined>;
}

export class InventoryService {
  constructor(
    private readonly paths: ResolvedPaths,
    private readonly io: InventoryIo,
  ) {}

  /** Files the host should watch to refresh the matrix. */
  watchedFiles(): string[] {
    return [this.paths.storageJson, this.paths.globalExtensionsJson, this.paths.profilesDir];
  }

  async getInventory(): Promise<Inventory> {
    const joinP = (a: string, b: string) => (a.includes('\\') ? `${a}\\${b}` : `${a}/${b}`);

    let rawProfiles: RawProfile[] = [];
    let registryError: Error | undefined;
    const storageText = await this.io.readFile(this.paths.storageJson);
    if (storageText instanceof Error) {
      registryError = storageText;
    } else if (storageText !== undefined) {
      try {
        rawProfiles = parseProfileRegistry(storageText);
      } catch (e) {
        registryError = e instanceof Error ? e : new Error(String(e));
      }
    }

    const readManifest = async (p: string): Promise<ManifestEntry[] | Error> => {
      const text = await this.io.readFile(p);
      if (text === undefined) return [];
      if (text instanceof Error) return text;
      try {
        return parseExtensionsManifest(text);
      } catch (e) {
        return e instanceof ParseError ? e : new Error(String(e));
      }
    };

    const defaultManifest = await readManifest(this.paths.globalExtensionsJson);
    const profileManifests = new Map<string, ManifestEntry[] | Error>();
    for (const p of rawProfiles) {
      if (p.inheritsDefaultExtensions) continue;
      profileManifests.set(
        p.location,
        await readManifest(joinP(joinP(this.paths.profilesDir, p.location), 'extensions.json')),
      );
    }

    const diskFolders = await this.io.listDirs(this.paths.extensionsDir);
    const obsoleteText = await this.io.readFile(this.paths.obsoleteFile);
    let obsoleteFolderNames: string[] = [];
    let obsoleteError: Error | undefined;
    if (obsoleteText instanceof Error) {
      obsoleteError = obsoleteText;
    } else if (obsoleteText !== undefined) {
      try {
        obsoleteFolderNames = parseObsolete(obsoleteText);
      } catch (e) {
        obsoleteError = e instanceof Error ? e : new Error(String(e));
      }
    }

    const displayNames = new Map<string, string>();
    const iconFsPaths = new Map<string, string>();
    const descriptions = new Map<string, string>();
    const publishers = new Map<string, string>();
    for (const folderName of diskFolders) {
      const parsed = parseExtensionFolderName(folderName);
      if (!parsed) continue;
      const needDisplayName = !displayNames.has(parsed.id);
      const needIcon = !iconFsPaths.has(parsed.id);
      const needDescription = !descriptions.has(parsed.id);
      const needPublisher = !publishers.has(parsed.id);
      if (!needDisplayName && !needIcon && !needDescription && !needPublisher) continue;
      const meta = await this.io.readPackageMeta(joinP(this.paths.extensionsDir, folderName));
      if (!meta) continue;
      if (needDisplayName && meta.displayName) displayNames.set(parsed.id, meta.displayName);
      if (needIcon && meta.icon && isSafeIconRelPath(meta.icon)) {
        const raw = `${this.paths.extensionsDir}/${folderName}/${meta.icon}`;
        iconFsPaths.set(parsed.id, raw.replaceAll('/', sep(this.paths.extensionsDir)));
      }
      if (needDescription && meta.description) descriptions.set(parsed.id, meta.description);
      if (needPublisher && meta.publisher) publishers.set(parsed.id, meta.publisher);
    }

    const inventory = composeInventory({
      rawProfiles,
      defaultManifest,
      profileManifests,
      diskFolders,
      obsoleteFolderNames,
      displayNames,
      iconFsPaths,
      descriptions,
      publishers,
      extensionsDir: this.paths.extensionsDir,
      // Without the registry, named profiles (and their manifests) are invisible; without
      // .obsolete we cannot tell stale folders from orphans. Suppress rather than guess.
      orphanKnowledgeUnreliable: obsoleteError !== undefined || registryError !== undefined,
    });
    if (obsoleteError) {
      inventory.warnings.push({
        file: 'extensions/.obsolete',
        message: obsoleteError.message,
        affectedProfileIds: [],
      });
    }
    if (registryError) {
      inventory.warnings.unshift({
        file: 'globalStorage/storage.json',
        message: registryError.message,
        affectedProfileIds: inventory.profiles.map((p) => p.id),
      });
    }
    return inventory;
  }
}
