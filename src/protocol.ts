// Message formats between the extension host and its two webviews (the Extension Matrix and
// Home). Kept apart from the domain types in core/types.ts: these change with the UI, not the data.
import type {
  Inventory,
  OrphanInfo,
  ParseWarning,
  WorkspaceDescriptor,
  WorkspaceExtensionCounts,
  WorkspaceInventory,
} from './core/types';

// --- Extension Matrix ---

export type HostToMatrix =
  | {
      type: 'inventory';
      inventory: Inventory;
      workspace?: WorkspaceInventory;
      icons: Record<string, string>;
    }
  | { type: 'pending'; extId: string; profileId: string }
  | { type: 'orphans'; orphans: OrphanInfo[] }
  | { type: 'cleanupResult'; results: { folderName: string; ok: boolean; error?: string }[] }
  | { type: 'unsupported'; reason: string };

export type MatrixToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'toggleCell'; extId: string; profileId: string; install: boolean }
  | { type: 'showApplyToAllProfilesGuide'; extId: string }
  | { type: 'showWorkspaceEnablementGuide'; extId: string }
  | { type: 'installInEveryProfile'; extId: string }
  | { type: 'removeFromEveryProfile'; extId: string }
  | { type: 'openExtensionPage'; extId: string }
  | { type: 'requestOrphans' }
  | { type: 'cleanup'; folderNames: string[] };

// --- Home (the sidebar) ---
// Separate from HostToMatrix/MatrixToHost above: Home is a much smaller surface, and mixing the
// two protocols would force every matrix message-type change to also touch Home (and vice versa)
// for no common benefit.

export interface HomeProfileVm {
  id: string;
  name: string;
  inheritsDefaultExtensions: boolean;
  direct: number;
  fromDefault: number;
  appliedToAllProfiles: number;
  /** Absolute fsPath to this profile's own extensions.json. Absent for a profile that inherits
   * the default profile's extensions — it has no file of its own to open or edit. */
  filePath?: string;
}

export interface HomeWorkspaceVm {
  name: string;
  kind: WorkspaceDescriptor['kind'];
  /** Local saved .code-workspace manifest. Never populated for a folder or non-file workspace. */
  manifestFsPath?: string;
  activeProfileName?: string;
  counts: WorkspaceExtensionCounts;
  warnings: string[];
}

export type HostToHome =
  | {
      type: 'state';
      profiles: HomeProfileVm[];
      workspace?: HomeWorkspaceVm;
      orphanCount: number;
      warnings: ParseWarning[];
    }
  | { type: 'orphanSize'; totalSizeBytes: number }
  | { type: 'unsupported'; reason: string };

export type HomeToHost =
  | { type: 'ready' }
  | { type: 'openMatrix' }
  | { type: 'openProfileReadOnly'; profileId: string }
  | { type: 'editProfileFile'; profileId: string }
  | { type: 'openWorkspaceReadOnly' }
  | { type: 'editWorkspaceFile' }
  | { type: 'reviewOrphans' };
