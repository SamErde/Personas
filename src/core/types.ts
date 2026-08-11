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
  /** Manifest-selected version for each profile. Unlike `versions`, this preserves which
   *  coexisting disk version the profile actually references. */
  profileVersions?: { profileId: string; version: string }[];
  applyToAllProfiles: boolean;
  installedIn: string[]; // Profile.id values (includes inheriting profiles)
  orphaned: boolean; // derived: installedIn.length === 0 && !applyToAllProfiles
  /** Absolute path to the icon file, composed from the first disk version folder that has one. */
  iconFsPath?: string;
  /** From package.json `description` — resolved independently of the other package.json fields,
   *  from the first disk version folder whose package.json carries it. */
  description?: string;
  /** From package.json `publisher` — resolved independently of the other package.json fields,
   *  from the first disk version folder whose package.json carries it. */
  publisher?: string;
  /** From the first manifest entry for this id (default manifest first, then profile manifests)
   *  that carries it — metadata.publisherDisplayName. */
  publisherDisplayName?: string;
  /** From the first manifest entry for this id (default manifest first, then profile manifests)
   *  that carries it — metadata.installedTimestamp. This is the local install time, not a
   *  marketplace publish date; offline data only. */
  installedTimestampMs?: number;
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

export type WorkspaceExtensionState =
  | 'enabled'
  | 'notEnabled'
  | 'notInstalledInProfile'
  | 'unknown';

export interface WorkspaceDescriptor {
  name: string;
  kind: 'folder' | 'workspace';
  /** Exact folder or saved-workspace URI used by VS Code's profile association map. */
  associationUri?: string;
  /** Local saved .code-workspace JSON file, when one exists and is safe to open directly. */
  manifestFsPath?: string;
  /** Local file-system roots only; non-file roots are deliberately omitted. */
  rootFsPaths: string[];
}

export interface WorkspaceLocalExtension {
  id: string;
  displayName: string;
  version?: string;
  description?: string;
  publisher?: string;
  fsPath: string;
  runtimeVisible: boolean;
}

export interface WorkspaceExtensionStatus {
  id: string;
  displayName: string;
  description?: string;
  publisher?: string;
  version?: string;
  state: WorkspaceExtensionState;
  installedInActiveProfile: boolean | 'unknown';
  workspaceLocal: 'installed' | 'candidate' | 'none';
  runtimeSource: 'profile' | 'workspace' | 'unknown';
  /** True only when this row has a normal profile-backed ExtensionRecord. */
  profileBacked: boolean;
  runtimeUri?: string;
  reason: string;
}

export interface WorkspaceInventory {
  descriptor: WorkspaceDescriptor;
  activeProfileId?: string;
  activeProfileName?: string;
  extensions: WorkspaceExtensionStatus[];
  localExtensions: WorkspaceLocalExtension[];
  warnings: string[];
}

export interface WorkspaceExtensionCounts {
  enabled: number;
  notEnabled: number;
  unknown: number;
  workspaceLocal: number;
}

export interface OrphanInfo {
  id: string;
  displayName: string;
  folders: { folderName: string; fsPath: string; sizeBytes: number; lastModifiedMs: number }[];
  totalSizeBytes: number;
}

// --- Webview message protocol ---

export type HostToWebview =
  | {
      type: 'inventory';
      inventory: Inventory;
      workspace?: WorkspaceInventory;
      toggleSupported: boolean;
      icons: Record<string, string>;
    }
  | { type: 'pending'; extId: string; profileId: string }
  | { type: 'orphans'; orphans: OrphanInfo[] }
  | { type: 'cleanupResult'; results: { folderName: string; ok: boolean; error?: string }[] }
  | { type: 'unsupported'; reason: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'toggleCell'; extId: string; profileId: string; install: boolean }
  | { type: 'toggleAllProfiles'; extId: string }
  | { type: 'installEverywhere'; extId: string }
  | { type: 'removeEverywhere'; extId: string }
  | { type: 'openExtensionPage'; extId: string }
  | { type: 'requestOrphans' }
  | { type: 'cleanup'; folderNames: string[] };

// --- Sidebar dashboard (welcome view) message protocol ---
// Separate from HostToWebview/WebviewToHost above: the sidebar is a much smaller surface and
// mixing the two protocols would force every matrix message-type change to also touch the
// sidebar (and vice versa) for no shared benefit.

export interface WelcomeProfileVm {
  id: string;
  name: string;
  inheritsDefaultExtensions: boolean;
  direct: number;
  shared: number;
  /** Absolute fsPath to this profile's own extensions.json. Absent for a profile that inherits
   * the default profile's extensions — it has no file of its own to open or edit. */
  filePath?: string;
}

export interface WelcomeWorkspaceVm {
  name: string;
  kind: WorkspaceDescriptor['kind'];
  /** Local saved .code-workspace manifest. Never populated for a folder or non-file workspace. */
  manifestFsPath?: string;
  activeProfileName?: string;
  counts: WorkspaceExtensionCounts;
  warnings: string[];
}

export type HostToWelcome =
  | {
      type: 'state';
      profiles: WelcomeProfileVm[];
      workspace?: WelcomeWorkspaceVm;
      orphanCount: number;
      warnings: ParseWarning[];
    }
  | { type: 'orphanSize'; totalSizeBytes: number }
  | { type: 'unsupported'; reason: string };

export type WelcomeToHost =
  | { type: 'ready' }
  | { type: 'openMatrix' }
  | { type: 'openProfileReadOnly'; profileId: string }
  | { type: 'editProfileFile'; profileId: string }
  | { type: 'openWorkspaceReadOnly' }
  | { type: 'editWorkspaceFile' }
  | { type: 'reviewOrphans' };
