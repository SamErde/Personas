export interface Profile {
  /** 'default' for the default profile, otherwise the registry `location` value. */
  id: string;
  name: string;
  isDefault: boolean;
  /** True when useDefaultFlags.extensions === true: shares the default profile's extensions. */
  inheritsDefaultExtensions: boolean;
}

export interface DiskVersion {
  version: string;
  folderName: string;
  fsPath: string;
}

export interface ExtensionRecord {
  id: string; // publisher.name, lowercase
  displayName: string;
  versions: DiskVersion[];
  applyToAllProfiles: boolean;
  installedIn: string[]; // Profile.id values (includes inheriting profiles)
  orphaned: boolean; // derived: installedIn.length === 0 && !applyToAllProfiles
}

export interface ParseWarning {
  file: string;
  message: string;
  /** Profiles whose data could not be read; mutations for these are disabled. */
  affectedProfileIds: string[];
}

export interface Inventory {
  profiles: Profile[];
  extensions: ExtensionRecord[];
  warnings: ParseWarning[];
}

export interface OrphanInfo {
  id: string;
  displayName: string;
  folders: { folderName: string; fsPath: string; sizeBytes: number; lastModifiedMs: number }[];
  totalSizeBytes: number;
}

// --- Webview message protocol ---

export type HostToWebview =
  | { type: 'inventory'; inventory: Inventory; toggleSupported: boolean }
  | { type: 'pending'; extId: string; profileId: string }
  | { type: 'orphans'; orphans: OrphanInfo[] }
  | { type: 'cleanupResult'; results: { folderName: string; ok: boolean; error?: string }[] }
  | { type: 'unsupported'; reason: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'toggleCell'; extId: string; profileId: string; install: boolean }
  | { type: 'toggleAllProfiles'; extId: string }
  | { type: 'requestOrphans' }
  | { type: 'cleanup'; folderNames: string[] };
