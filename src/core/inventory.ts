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
  const appScoped = new Set<string>();
  const add = (id: string, profileId: string) => {
    let set = membership.get(id);
    if (!set) membership.set(id, (set = new Set()));
    set.add(profileId);
  };

  const inheritingIds = profiles.filter((p) => p.inheritsDefaultExtensions).map((p) => p.id);
  for (const e of defaultEntries) {
    add(e.id, 'default');
    for (const pid of inheritingIds) add(e.id, pid);
    if (e.isApplicationScoped) appScoped.add(e.id);
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
      add(e.id, p.location);
      if (e.isApplicationScoped) appScoped.add(e.id);
    }
  }

  // App-scoped extensions are active in every profile.
  for (const id of appScoped) for (const p of profiles) add(id, p.id);

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
      return {
        id,
        displayName: input.displayNames.get(id) ?? id,
        versions: versionsById.get(id) ?? [],
        applyToAllProfiles: isAppScoped,
        installedIn,
        orphaned: installedIn.length === 0 && !isAppScoped,
      };
    });
  extensions.sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));

  return { profiles, extensions, warnings };
}

function sep(referencePath: string): string {
  return referencePath.includes('\\') ? '\\' : '/';
}

// ---------- IO wrapper ----------

export interface InventoryIo {
  /** undefined when the file does not exist */
  readFile(p: string): Promise<string | undefined>;
  listDirs(p: string): Promise<string[]>;
  /** best-effort displayName from <folder>/package.json */
  readDisplayName(extFolderPath: string): Promise<string | undefined>;
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
    if (storageText !== undefined) {
      try {
        rawProfiles = parseProfileRegistry(storageText);
      } catch (e) {
        registryError = e instanceof Error ? e : new Error(String(e));
      }
    }

    const readManifest = async (p: string): Promise<ManifestEntry[] | Error> => {
      const text = await this.io.readFile(p);
      if (text === undefined) return [];
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
    if (obsoleteText !== undefined) {
      try {
        obsoleteFolderNames = parseObsolete(obsoleteText);
      } catch (e) {
        obsoleteError = e instanceof Error ? e : new Error(String(e));
      }
    }

    const displayNames = new Map<string, string>();
    for (const folderName of diskFolders) {
      const parsed = parseExtensionFolderName(folderName);
      if (!parsed || displayNames.has(parsed.id)) continue;
      const name = await this.io.readDisplayName(joinP(this.paths.extensionsDir, folderName));
      if (name) displayNames.set(parsed.id, name);
    }

    const inventory = composeInventory({
      rawProfiles,
      defaultManifest,
      profileManifests,
      diskFolders,
      obsoleteFolderNames,
      displayNames,
      extensionsDir: this.paths.extensionsDir,
      // Without .obsolete we cannot tell stale folders from orphans — suppress rather than guess.
      orphanKnowledgeUnreliable: obsoleteError !== undefined,
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
