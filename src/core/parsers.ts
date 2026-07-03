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
    const isApplicationScoped =
      typeof metadata === 'object' && metadata !== null &&
      (metadata as Record<string, unknown>)['isApplicationScoped'] === true;
    entries.push({
      id: id.toLowerCase(),
      version: e['version'],
      relativeLocation: typeof e['relativeLocation'] === 'string' ? e['relativeLocation'] : '',
      isApplicationScoped,
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
