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
  /** From package.json `categories` in the folders that the profile manifests point to, merged
   *  across profiles and sorted. Absent when no such folder declares any, which includes
   *  disk-only (orphaned) records; consumers treat that as unknown. */
  categories?: string[];
  /** Every distinct manifest `metadata.source` value across profiles, as written and sorted, so
   *  an unrecognized value stays distinguishable from a known one. */
  installSources?: string[];
  /** True when at least one manifest entry for this id has no usable `metadata.source`, when no
   *  manifest entry exists at all (a disk-only record), or when any manifest is unreadable and so
   *  may hold another source. Consumers treat this as unknown. */
  installSourceMissing?: true;
}

export interface ParseWarning {
  file: string;
  message: string;
  /** Profiles whose data could not be read; mutations for these are disabled. */
  affectedProfileIds: string[];
  /** 'duplicateName': the profiles' data is readable, but the code CLI can't tell them apart by
   *  name, so changes are disabled. 'profileRegistry': VS Code's profile registry could not be
   *  read, so changes are disabled even though each listed profile's extensions were read.
   *  Absent: the affected profiles' data could not be read. */
  kind?: 'duplicateName' | 'profileRegistry';
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
