export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface RawProfile {
  location: string;
  name: string;
  inheritsDefaultExtensions: boolean;
}

export interface ManifestEntry {
  id: string;
  version: string;
  /** VS Code's on-disk `metadata.isApplicationScoped` ("Apply Extension to all Profiles"). */
  applyToAllProfiles: boolean;
  /** From metadata.publisherDisplayName, when present and string-typed. */
  publisherDisplayName?: string;
  /** From metadata.installedTimestamp, when present and number-typed. */
  installedTimestamp?: number;
}

export interface PackageMeta {
  displayName?: string;
  icon?: string;
  description?: string;
  publisher?: string;
}

export interface ParsedWorkspaceProfileAssociations {
  workspaces: Map<string, string>;
  warnings: string[];
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ParseError(`${what}: invalid JSON — ${String(e)}`);
  }
}

export function parseProfileRegistry(text: string): RawProfile[] {
  const root = parseJson(text, 'storage.json');
  if (typeof root !== 'object' || root === null) throw new ParseError('storage.json: not an object');
  const list = (root as Record<string, unknown>)['userDataProfiles'];
  if (!Array.isArray(list)) return [];
  const profiles: RawProfile[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e['location'] !== 'string' || typeof e['name'] !== 'string') continue;
    const flags = e['useDefaultFlags'];
    const inherits =
      typeof flags === 'object' && flags !== null && (flags as Record<string, unknown>)['extensions'] === true;
    profiles.push({ location: e['location'], name: e['name'], inheritsDefaultExtensions: inherits });
  }
  return profiles;
}

/**
 * Reads only the optional workspace/profile association map from storage.json. Invalid entries
 * are ignored individually and reported so one bad association cannot hide all valid ones.
 */
export function parseWorkspaceProfileAssociations(text: string): ParsedWorkspaceProfileAssociations {
  const root = parseJson(text, 'storage.json');
  if (typeof root !== 'object' || root === null) throw new ParseError('storage.json: not an object');
  const associations = (root as Record<string, unknown>)['profileAssociations'];
  if (associations === undefined) return { workspaces: new Map(), warnings: [] };
  if (typeof associations !== 'object' || associations === null || Array.isArray(associations)) {
    return {
      workspaces: new Map(),
      warnings: ['profileAssociations is not an object.'],
    };
  }
  const rawWorkspaces = (associations as Record<string, unknown>)['workspaces'];
  if (rawWorkspaces === undefined) return { workspaces: new Map(), warnings: [] };
  if (typeof rawWorkspaces !== 'object' || rawWorkspaces === null || Array.isArray(rawWorkspaces)) {
    return {
      workspaces: new Map(),
      warnings: ['profileAssociations.workspaces is not an object.'],
    };
  }

  const workspaces = new Map<string, string>();
  const warnings: string[] = [];
  for (const [uri, profileId] of Object.entries(rawWorkspaces as Record<string, unknown>)) {
    const displayUri = uri.trim() === '' ? '<empty key>' : uri;
    if (uri.trim() === '' || typeof profileId !== 'string' || profileId.trim() === '') {
      warnings.push(`Ignored malformed workspace profile association for ${displayUri}.`);
      continue;
    }
    workspaces.set(uri, profileId);
  }
  return { workspaces, warnings };
}

export function parseExtensionsManifest(text: string): ManifestEntry[] {
  const root = parseJson(text, 'extensions.json');
  if (!Array.isArray(root)) throw new ParseError('extensions.json: expected a JSON array');
  const entries: ManifestEntry[] = [];
  for (const entry of root) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const identifier = e['identifier'];
    const id =
      typeof identifier === 'object' && identifier !== null
        ? (identifier as Record<string, unknown>)['id']
        : undefined;
    if (typeof id !== 'string' || typeof e['version'] !== 'string') continue;
    const metadata = e['metadata'];
    const metaObj = typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : undefined;
    const applyToAllProfiles = metaObj?.['isApplicationScoped'] === true;
    const publisherDisplayName =
      typeof metaObj?.['publisherDisplayName'] === 'string' ? metaObj['publisherDisplayName'] : undefined;
    const installedTimestamp =
      typeof metaObj?.['installedTimestamp'] === 'number' ? metaObj['installedTimestamp'] : undefined;
    entries.push({
      id: normalizeExtensionId(id),
      version: e['version'],
      applyToAllProfiles,
      ...(publisherDisplayName !== undefined ? { publisherDisplayName } : {}),
      ...(installedTimestamp !== undefined ? { installedTimestamp } : {}),
    });
  }
  return entries;
}

/** Reads the package.json fields the inventory shows. Throws ParseError on invalid JSON. */
export function parsePackageMeta(text: string): PackageMeta {
  const root = parseJson(text, 'package.json');
  if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new ParseError('package.json: not an object');
  const pkg = root as Record<string, unknown>;
  return {
    displayName: unlocalizedString(pkg['displayName']),
    icon: typeof pkg['icon'] === 'string' ? pkg['icon'] : undefined,
    description: unlocalizedString(pkg['description']),
    publisher: typeof pkg['publisher'] === 'string' ? pkg['publisher'] : undefined,
  };
}

/**
 * A package.json string field, or undefined when it is missing, not a string, or an unresolved
 * `%key%` localization placeholder (resolving it would need the extension's package.nls.json).
 */
export function unlocalizedString(value: unknown): string | undefined {
  return typeof value === 'string' && !value.startsWith('%') ? value : undefined;
}

/** Extension ids are case-insensitive; every id is compared in this lowercase form. */
export function normalizeExtensionId(id: string): string {
  return id.toLowerCase();
}

export function parseObsolete(text: string): string[] {
  if (text.trim() === '') return [];
  const root = parseJson(text, '.obsolete');
  if (typeof root !== 'object' || root === null) return [];
  return Object.entries(root as Record<string, unknown>)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

/** Folder names look like `publisher.name-1.2.3` optionally with a `-platform-arch` suffix. */
const FOLDER_RE = /^([a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*)-(\d.*)$/i;

export function parseExtensionFolderName(
  folderName: string,
): { id: string; version: string } | undefined {
  const m = FOLDER_RE.exec(folderName);
  if (!m || m[1] === undefined || m[2] === undefined) return undefined;
  return { id: normalizeExtensionId(m[1]), version: m[2] };
}
