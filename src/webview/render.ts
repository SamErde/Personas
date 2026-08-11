import type { Inventory, WorkspaceExtensionStatus, WorkspaceInventory } from '../core/types';

export type Chip = 'all' | 'orphaned' | 'allProfiles';

export interface CellVm {
  profileId: string;
  installed: boolean;
  inherited: boolean;
  /** True when this profile's extensions.json failed to parse — mutations disabled. */
  disabled: boolean;
  /** Workspace-only rows never expose a profile mutation, even when the id exists in a gallery. */
  workspaceOnly: boolean;
}

export interface WorkspaceCellVm {
  state: WorkspaceExtensionStatus['state'];
  label: 'Enabled' | 'Not enabled' | 'Not installed in profile' | 'Workspace-local' | 'Unknown';
  symbol: string;
  tooltip: string;
}

export interface RowVm {
  extId: string;
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
  profileNames: { id: string; name: string; inherits: boolean }[];
  workspace?: { name: string; kind: WorkspaceInventory['descriptor']['kind'] };
  rows: RowVm[];
  orphanCount: number;
  warnings: Inventory['warnings'];
  workspaceWarnings: string[];
}

export function supportsProfileActions(row: Pick<RowVm, 'profileBacked'>): boolean {
  return row.profileBacked;
}

export function buildViewModel(
  inv: Inventory,
  state: { filter: string; chip: Chip },
  workspace?: WorkspaceInventory,
): ViewModel {
  const filter = state.filter.trim().toLowerCase();
  const disabledIds = new Set(inv.warnings.flatMap((warning) => warning.affectedProfileIds));
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
    if (state.chip === 'allProfiles' && (!profileBacked || !applyToAllProfiles)) continue;
    if (filter && !id.includes(filter) && !displayName.toLowerCase().includes(filter)) continue;

    const latestVersion = extension?.versions.at(-1)?.version ?? workspaceStatus?.version;
    const sourceLabel = workspaceStatus
      ? workspaceStatus.workspaceLocal === 'installed'
        ? 'Workspace-local'
        : workspaceStatus.workspaceLocal === 'candidate'
          ? 'Workspace-local candidate'
          : undefined
      : undefined;
    rows.push({
      extId: id,
      displayName,
      applyToAllProfiles,
      orphaned,
      profileBacked,
      cells: inv.profiles.map((profile) => ({
        profileId: profile.id,
        installed: extension?.installedIn.includes(profile.id) ?? false,
        inherited: profile.inheritsDefaultExtensions,
        disabled: profileBacked && disabledIds.has(profile.id),
        workspaceOnly: !profileBacked,
      })),
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
      a.extId.localeCompare(b.extId),
  );

  return {
    profileNames: inv.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      inherits: profile.inheritsDefaultExtensions,
    })),
    ...(workspace ? { workspace: { name: workspace.descriptor.name, kind: workspace.descriptor.kind } } : {}),
    rows,
    orphanCount: inv.extensions.filter((extension) => extension.orphaned).length,
    warnings: inv.warnings,
    workspaceWarnings: workspace?.warnings ?? [],
  };
}

function toWorkspaceCell(status: WorkspaceExtensionStatus): WorkspaceCellVm {
  if (
    status.state === 'enabled' &&
    status.workspaceLocal === 'installed' &&
    status.installedInActiveProfile !== true
  ) {
    return {
      state: status.state,
      label: 'Workspace-local',
      symbol: 'W ✓',
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

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
