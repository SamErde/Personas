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
  relativeLocation: string;
  isApplicationScoped: boolean;
  /** From metadata.publisherDisplayName, when present and string-typed. */
  publisherDisplayName?: string;
  /** From metadata.installedTimestamp, when present and number-typed. */
  installedTimestamp?: number;
}

export interface ParsedWorkspaceProfileAssociations {
  workspaces: Map<string, string>;
  warnings: string[];
  present: boolean;
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
  if (associations === undefined) return { workspaces: new Map(), warnings: [], present: false };
  if (typeof associations !== 'object' || associations === null || Array.isArray(associations)) {
    return {
      workspaces: new Map(),
      warnings: ['profileAssociations is not an object.'],
      present: false,
    };
  }
  const rawWorkspaces = (associations as Record<string, unknown>)['workspaces'];
  if (rawWorkspaces === undefined) return { workspaces: new Map(), warnings: [], present: false };
  if (typeof rawWorkspaces !== 'object' || rawWorkspaces === null || Array.isArray(rawWorkspaces)) {
    return {
      workspaces: new Map(),
      warnings: ['profileAssociations.workspaces is not an object.'],
      present: false,
    };
  }

  const workspaces = new Map<string, string>();
  const warnings: string[] = [];
  for (const [uri, profileId] of Object.entries(rawWorkspaces as Record<string, unknown>)) {
    if (uri.trim() === '' || typeof profileId !== 'string' || profileId.trim() === '') {
      warnings.push(`Ignored malformed workspace profile association for ${uri || '<empty key>'}.`);
      continue;
    }
    workspaces.set(uri, profileId);
  }
  return { workspaces, warnings, present: true };
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
    const isApplicationScoped = metaObj?.['isApplicationScoped'] === true;
    const publisherDisplayName =
      typeof metaObj?.['publisherDisplayName'] === 'string' ? metaObj['publisherDisplayName'] : undefined;
    const installedTimestamp =
      typeof metaObj?.['installedTimestamp'] === 'number' ? metaObj['installedTimestamp'] : undefined;
    entries.push({
      id: id.toLowerCase(),
      version: e['version'],
      relativeLocation: typeof e['relativeLocation'] === 'string' ? e['relativeLocation'] : '',
      isApplicationScoped,
      ...(publisherDisplayName !== undefined ? { publisherDisplayName } : {}),
      ...(installedTimestamp !== undefined ? { installedTimestamp } : {}),
    });
  }
  return entries;
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
  return { id: m[1].toLowerCase(), version: m[2] };
}
