import type { Inventory } from '../core/types';

export type Chip = 'all' | 'orphaned' | 'allProfiles';

export interface CellVm {
  profileId: string;
  installed: boolean;
  inherited: boolean;
  /** True when this profile's extensions.json failed to parse — mutations disabled. */
  disabled: boolean;
}

export interface RowVm {
  extId: string;
  displayName: string;
  version: string;
  applyToAllProfiles: boolean;
  orphaned: boolean;
  cells: CellVm[];
}

export interface ViewModel {
  profileNames: { id: string; name: string; inherits: boolean }[];
  rows: RowVm[];
  orphanCount: number;
  warnings: Inventory['warnings'];
}

export function buildViewModel(inv: Inventory, state: { filter: string; chip: Chip }): ViewModel {
  const filter = state.filter.trim().toLowerCase();
  const disabledIds = new Set(inv.warnings.flatMap((w) => w.affectedProfileIds));
  const rows = inv.extensions
    .filter((e) => {
      if (state.chip === 'orphaned' && !e.orphaned) return false;
      if (state.chip === 'allProfiles' && !e.applyToAllProfiles) return false;
      if (filter && !e.id.includes(filter) && !e.displayName.toLowerCase().includes(filter)) return false;
      return true;
    })
    .map((e) => ({
      extId: e.id,
      displayName: e.displayName,
      version: e.versions[e.versions.length - 1]?.version ?? '',
      applyToAllProfiles: e.applyToAllProfiles,
      orphaned: e.orphaned,
      cells: inv.profiles.map((p) => ({
        profileId: p.id,
        installed: e.installedIn.includes(p.id),
        inherited: p.inheritsDefaultExtensions,
        disabled: disabledIds.has(p.id),
      })),
    }));
  return {
    profileNames: inv.profiles.map((p) => ({ id: p.id, name: p.name, inherits: p.inheritsDefaultExtensions })),
    rows,
    orphanCount: inv.extensions.filter((e) => e.orphaned).length,
    warnings: inv.warnings,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
