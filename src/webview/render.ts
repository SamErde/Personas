import {
  offersWorkspaceEnablementGuide,
  profileLabel,
  profileName,
  profileWarnings,
  type ProfileWarnings,
} from '../core/inventoryQueries';
import type { ExtensionRecord, Inventory, Profile, WorkspaceExtensionStatus, WorkspaceInventory } from '../core/types';
import type { FilterDimension, MatrixFilters } from '../protocol';

/** The value a row matches in a dimension when it has no data for it. */
export const UNKNOWN_VALUE = '';

const FILTER_DIMENSIONS = ['categories', 'publishers', 'sources'] as const satisfies readonly FilterDimension[];

/** Frozen, because every filter state is spread from it and shares its arrays. */
export const NO_FILTERS: MatrixFilters = Object.freeze({
  view: 'all',
  text: '',
  categories: Object.freeze([]),
  publishers: Object.freeze([]),
  sources: Object.freeze([]),
});

/** A row's values in each multi-value dimension, with missing data as UNKNOWN_VALUE. */
function dimensionValues(
  extension: ExtensionRecord | undefined,
  publisher: string | undefined,
): Record<FilterDimension, string[]> {
  const categories = extension?.categories?.length ? extension.categories : [UNKNOWN_VALUE];
  const sources = [
    ...(extension?.installSources ?? []),
    // A workspace-only row has no manifest entry, so its source is unknown too.
    ...(!extension || extension.installSourceMissing || !extension.installSources?.length ? [UNKNOWN_VALUE] : []),
  ];
  return { categories, publishers: [publisher ?? UNKNOWN_VALUE], sources };
}

function matchesDimensions(values: ReturnType<typeof dimensionValues>, filters: MatrixFilters): boolean {
  return FILTER_DIMENSIONS.every(
    (dimension) => filters[dimension].length === 0 || values[dimension].some((value) => filters[dimension].includes(value)),
  );
}

/** What is known about an extension's install in one profile. Unknown means the profile's list,
 * or the Default list it uses, could not be read. */
export type InstallState = 'installed' | 'notInstalled' | 'unknown';

/** Why a cell cannot install or uninstall. */
export type ReadOnlyReason =
  /** The row exists only in the current workspace, so no profile action applies. */
  | 'workspaceOnly'
  /** The profile uses the Default profile's extensions instead of its own. */
  | 'inheritsDefault'
  /** The profile's extension list could not be read. */
  | 'unreadable'
  /** The code CLI cannot tell this profile apart by name. */
  | 'duplicateName'
  /** VS Code's profile registry could not be read, so no change is safe to target. */
  | 'profileRegistry'
  /** VS Code applies the extension to every profile; only VS Code can change that. */
  | 'appliedToAllProfiles';

export interface CellVm {
  profileId: string;
  install: InstallState;
  /** The reason is absent when the cell is a writable checkbox. */
  readOnlyReason?: ReadOnlyReason;
}

export interface WorkspaceCellVm {
  state: WorkspaceExtensionStatus['state'];
  label: 'Enabled' | 'Not enabled' | 'Not installed in profile' | 'Workspace-local' | 'Unknown';
  symbol: string;
  tooltip: string;
  /** The cell is a button that hands off to VS Code's Extensions view (ADR-0003). */
  offersEnablementGuide: boolean;
}

export interface RowVm {
  /** The extension id. A record names its own key `id`; anything that refers to an extension
   *  from elsewhere (messages, parameters, data attributes) names it `extId`. */
  id: string;
  displayName: string;
  applyToAllProfiles: boolean;
  orphaned: boolean;
  profileBacked: boolean;
  description?: string;
  publisher?: string;
  publisherDisplayName?: string;
  version?: string;
  installedTimestampMs?: number;
  sourceLabel?: string;
  cells: CellVm[];
  workspaceCell?: WorkspaceCellVm;
}

export interface ViewModel {
  /** Column headers in profile order. `name` is the plain name used in accessible names (from
   *  profileName); `label`/`tooltip` come from profileLabel. */
  profileNames: { id: string; name: string; label: string; tooltip?: string }[];
  workspace?: { name: string; kind: WorkspaceInventory['descriptor']['kind'] };
  rows: RowVm[];
  /** How many rows there are before any filter, for "42 of 180 extensions". */
  total: number;
  warnings: Inventory['warnings'];
  workspaceWarnings: string[];
}

export function buildViewModel(
  inv: Inventory,
  filters: MatrixFilters,
  workspace?: WorkspaceInventory,
): ViewModel {
  const text = filters.text.trim().toLowerCase();
  const warned = profileWarnings(inv);
  const workspaceById = new Map(workspace?.extensions.map((extension) => [extension.id, extension]) ?? []);
  const profileById = new Map(inv.extensions.map((extension) => [extension.id, extension]));
  const allIds = new Set([...profileById.keys(), ...workspaceById.keys()]);
  const rows: RowVm[] = [];

  for (const id of allIds) {
    const extension = profileById.get(id);
    const workspaceStatus = workspaceById.get(id);
    const profileBacked = extension !== undefined;
    const displayName = extension?.displayName ?? workspaceStatus?.displayName ?? id;
    const applyToAllProfiles = extension?.applyToAllProfiles ?? false;
    const orphaned = extension?.orphaned ?? false;
    const publisher = extension?.publisher ?? workspaceStatus?.publisher;
    const publisherDisplayName = extension?.publisherDisplayName;
    if (filters.view === 'orphaned' && (!profileBacked || !orphaned)) continue;
    if (filters.view === 'appliedToAllProfiles' && (!profileBacked || !applyToAllProfiles)) continue;
    if (text && ![id, displayName, publisher, publisherDisplayName].some((value) => value?.toLowerCase().includes(text))) {
      continue;
    }
    if (!matchesDimensions(dimensionValues(extension, publisher), filters)) continue;

    // In a loaded workspace, the workspace composer has resolved the active profile manifest or
    // effective runtime location. Never overwrite that with arbitrary disk enumeration order.
    const latestVersion = workspace ? workspaceStatus?.version : extension?.versions.at(-1)?.version;
    const sourceLabel = workspaceStatus
      ? workspaceStatus.workspaceLocal === 'installed'
        ? 'Workspace-local'
        : workspaceStatus.workspaceLocal === 'candidate'
          ? 'Workspace-local candidate'
          : undefined
      : undefined;
    rows.push({
      id,
      displayName,
      applyToAllProfiles,
      orphaned,
      profileBacked,
      cells: inv.profiles.map((profile) => toCell(profile, extension, warned)),
      ...(workspaceStatus ? { workspaceCell: toWorkspaceCell(workspaceStatus) } : {}),
      ...(extension?.description ?? workspaceStatus?.description
        ? { description: extension?.description ?? workspaceStatus?.description }
        : {}),
      ...(publisher ? { publisher } : {}),
      ...(publisherDisplayName ? { publisherDisplayName } : {}),
      ...(latestVersion ? { version: latestVersion } : {}),
      ...(extension?.installedTimestampMs !== undefined
        ? { installedTimestampMs: extension.installedTimestampMs }
        : {}),
      ...(sourceLabel ? { sourceLabel } : {}),
    });
  }
  rows.sort(
    (a, b) =>
      a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()) ||
      a.id.localeCompare(b.id),
  );

  return {
    profileNames: inv.profiles.map((profile) => ({ id: profile.id, name: profileName(profile), ...profileLabel(profile) })),
    ...(workspace ? { workspace: { name: workspace.descriptor.name, kind: workspace.descriptor.kind } } : {}),
    rows,
    total: allIds.size,
    warnings: inv.warnings,
    workspaceWarnings: workspace?.warnings ?? [],
  };
}

/** Works out what is known about one cell's install, separately from whether the cell can act.
 * Checks run from the reason that holds for the whole row to the reasons tied to one profile. */
function toCell(profile: Profile, extension: ExtensionRecord | undefined, warned: ProfileWarnings): CellVm {
  const cell = (install: InstallState, readOnlyReason?: ReadOnlyReason): CellVm => ({
    profileId: profile.id,
    install,
    ...(readOnlyReason ? { readOnlyReason } : {}),
  });
  if (!extension) return cell('notInstalled', 'workspaceOnly');
  // VS Code applies these extensions to every profile, whichever manifest carried the flag.
  if (extension.applyToAllProfiles) return cell('installed', 'appliedToAllProfiles');
  const install: InstallState = warned.unreadable.has(profile.id)
    ? 'unknown'
    : extension.installedIn.includes(profile.id)
      ? 'installed'
      : 'notInstalled';
  if (profile.inheritsDefaultExtensions) return cell(install, 'inheritsDefault');
  if (warned.unreadable.has(profile.id)) return cell(install, 'unreadable');
  if (warned.profileRegistry.has(profile.id)) return cell(install, 'profileRegistry');
  if (warned.duplicateName.has(profile.id)) return cell(install, 'duplicateName');
  return cell(install);
}

function toWorkspaceCell(status: WorkspaceExtensionStatus): WorkspaceCellVm {
  return { ...describeWorkspaceStatus(status), offersEnablementGuide: offersWorkspaceEnablementGuide(status) };
}

function describeWorkspaceStatus(status: WorkspaceExtensionStatus): Omit<WorkspaceCellVm, 'offersEnablementGuide'> {
  if (
    status.state === 'enabled' &&
    status.workspaceLocal === 'installed' &&
    status.installedInActiveProfile !== true
  ) {
    return {
      state: status.state,
      label: 'Workspace-local',
      symbol: '✓ W',
      tooltip: `Workspace-local — ${status.reason}`,
    };
  }
  switch (status.state) {
    case 'enabled':
      return { state: status.state, label: 'Enabled', symbol: '✓', tooltip: `Enabled — ${status.reason}` };
    case 'notEnabled':
      return { state: status.state, label: 'Not enabled', symbol: '○', tooltip: `Not enabled — ${status.reason}` };
    case 'notInstalledInProfile':
      return {
        state: status.state,
        label: 'Not installed in profile',
        symbol: '—',
        tooltip: `Not installed in profile — ${status.reason}`,
      };
    case 'unknown':
      return { state: status.state, label: 'Unknown', symbol: '?', tooltip: `Unknown — ${status.reason}` };
  }
}
