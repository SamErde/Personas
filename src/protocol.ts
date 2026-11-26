import type { PowerShellInventory } from './powershell/profiles';
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

/** A view is a lens on the whole list rather than an attribute, so exactly one is selected. Orphans
 * have no view of their own: the matrix offers to review them whenever there are any. */
export type MatrixView = 'all' | 'appliedToAllProfiles';

/** The filters that narrow by any of several values. */
export type FilterDimension = 'categories' | 'publishers' | 'sources';

/**
 * What the matrix is narrowed by. A row must match every dimension (they combine with "and"), and
 * it matches a dimension when it has any of the selected values (values combine with "or"). An
 * empty value list leaves its dimension unfiltered. A row with no data for a dimension matches
 * its Unknown value (UNKNOWN_VALUE in webview/render.ts).
 */
export interface MatrixFilters {
  view: MatrixView;
  /** Matched, case-insensitively, against the extension's ID, name, and publisher. */
  text: string;
  /** Category names from package.json. */
  categories: readonly string[];
  /** Publisher IDs, lowercase. */
  publishers: readonly string[];
  /** Manifest `metadata.source` values that have a label of their own (SOURCE_LABELS in
   *  webview/render.ts), or OTHER_SOURCE for any other value written. */
  sources: readonly string[];
}

/** How the matrix arranges the rows the filters chose: in one list, or in groups by the first
 * letter of the name or by publisher. */
export const MATRIX_GROUPINGS = ['none', 'name', 'publisher'] as const;
export type MatrixGroupBy = (typeof MATRIX_GROUPINGS)[number];

/** How the person has set up the matrix. The extension host keeps it for the session so that a
 * reopened panel comes back the same way; it is not saved across VS Code restarts. */
export interface MatrixViewState {
  filters: MatrixFilters;
  groupBy: MatrixGroupBy;
}

export type HostToMatrix =
  | {
      type: 'inventory';
      inventory: Inventory;
      workspace?: WorkspaceInventory;
      icons: Record<string, string>;
    }
  | { type: 'pending'; extId: string; profileId: string }
  /** The session's last view state, sent to a newly opened panel before its first inventory. */
  | { type: 'viewState'; state: MatrixViewState }
  | { type: 'orphans'; orphans: OrphanInfo[] }
  | { type: 'cleanupResult'; results: { folderName: string; ok: boolean; error?: string }[] }
  | { type: 'unsupported'; reason: string };

export type MatrixToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  /** The view state after each change, for the host to keep for the session. */
  | { type: 'viewState'; state: MatrixViewState }
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
  /** Display name and tooltip from profileLabel (a leading ⤷ for profiles using Default's
   * extensions). */
  label: string;
  tooltip?: string;
  /** VS Code's built-in Agents window profile. */
  agentsWindow: boolean;
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

/** Home is several sidebar views, each with its own page and its own messages. */
export type HostToVsCodeProfiles =
  | {
      type: 'state';
      profiles: HomeProfileVm[];
      workspace?: HomeWorkspaceVm;
      orphanCount: number;
      warnings: ParseWarning[];
    }
  | { type: 'orphanSize'; totalSizeBytes: number }
  | { type: 'unsupported'; reason: string };

export type VsCodeProfilesToHost =
  | { type: 'ready' }
  | { type: 'openMatrix' }
  | { type: 'editProfileFile'; profileId: string }
  | { type: 'openWorkspaceReadOnly' }
  | { type: 'editWorkspaceFile' }
  | { type: 'reviewOrphans' };

export type HostToPowerShellProfiles =
  | { type: 'powerShellState'; inventory: PowerShellInventory; allowRuntimeDiscovery: boolean }
  | { type: 'showPowerShellHelp' };

/** Refresh and Help are buttons in the view's title bar, so the host starts them; the page sends the rest. */
export type PowerShellAction = {
  type: 'powerShellAction';
  action: 'refresh' | 'openSettings' | 'resolve' | 'open' | 'delete' | 'copy' | 'reveal';
  id?: string;
};
export type PowerShellProfilesToHost = { type: 'ready' } | PowerShellAction;
