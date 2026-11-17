import {
  duplicateNameProfileIds,
  offersWorkspaceEnablementGuide,
  profileLabel,
  profileName,
  unreadableProfileIds,
} from '../core/inventoryQueries';
import type { ExtensionRecord, Inventory, Profile, WorkspaceExtensionStatus, WorkspaceInventory } from '../core/types';

export type Chip = 'all' | 'orphaned' | 'appliedToAllProfiles';

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
  /** VS Code applies the extension to every profile; only VS Code can change that. */
  | 'appliedToAllProfiles';

export interface CellVm {
  profileId: string;
  install: InstallState;
  /** Absent when the cell is a writable checkbox. */
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
  warnings: Inventory['warnings'];
  workspaceWarnings: string[];
}

export function buildViewModel(
  inv: Inventory,
  state: { filter: string; chip: Chip },
  workspace?: WorkspaceInventory,
): ViewModel {
  const filter = state.filter.trim().toLowerCase();
  const unreadableIds = unreadableProfileIds(inv);
  const duplicateNameIds = duplicateNameProfileIds(inv);
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
    if (state.chip === 'orphaned' && (!profileBacked || !orphaned)) continue;
    if (state.chip === 'appliedToAllProfiles' && (!profileBacked || !applyToAllProfiles)) continue;
    if (filter && !id.includes(filter) && !displayName.toLowerCase().includes(filter)) continue;

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
      cells: inv.profiles.map((profile) => toCell(profile, extension, unreadableIds, duplicateNameIds)),
      ...(workspaceStatus ? { workspaceCell: toWorkspaceCell(workspaceStatus) } : {}),
      ...(extension?.description ?? workspaceStatus?.description
        ? { description: extension?.description ?? workspaceStatus?.description }
        : {}),
      ...(extension?.publisher ?? workspaceStatus?.publisher
        ? { publisher: extension?.publisher ?? workspaceStatus?.publisher }
        : {}),
      ...(extension?.publisherDisplayName ? { publisherDisplayName: extension.publisherDisplayName } : {}),
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
    warnings: inv.warnings,
    workspaceWarnings: workspace?.warnings ?? [],
  };
}

function toCell(
  profile: Profile,
  extension: ExtensionRecord | undefined,
  unreadableIds: Set<string>,
  duplicateNameIds: Set<string>,
): CellVm {
  const install: InstallState = !extension
    ? 'notInstalled'
    : unreadableIds.has(profile.id)
      ? 'unknown'
      : extension.installedIn.includes(profile.id)
        ? 'installed'
        : 'notInstalled';
  const readOnlyReason: ReadOnlyReason | undefined = !extension
    ? 'workspaceOnly'
    : profile.inheritsDefaultExtensions
      ? 'inheritsDefault'
      : unreadableIds.has(profile.id)
        ? 'unreadable'
        : duplicateNameIds.has(profile.id)
          ? 'duplicateName'
          : extension.applyToAllProfiles
            ? 'appliedToAllProfiles'
            : undefined;
  return { profileId: profile.id, install, ...(readOnlyReason ? { readOnlyReason } : {}) };
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
