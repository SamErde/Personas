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

/** Install sources with a label of their own. `resource` is left out because no install path that
 * writes it has been verified (docs/plans/2026-11-15-extension-matrix-filters.md, Uncertainty log). */
export const SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({ gallery: 'Marketplace', vsix: 'VSIX' });

/** The source value every install source without a label matches. Any written value that is not
 * a key of SOURCE_LABELS falls here, so a raw value that happens to equal it is still Other. */
export const OTHER_SOURCE = 'other';

const UNKNOWN_LABEL = 'Unknown';

/** The filter dimensions in the order the filter groups and chips show them. */
export const FILTER_DIMENSIONS = ['categories', 'publishers', 'sources'] as const satisfies readonly FilterDimension[];

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
    ...(extension?.installSources ?? []).map((source) => (Object.hasOwn(SOURCE_LABELS, source) ? source : OTHER_SOURCE)),
    // A workspace-only row has no manifest entry, so its source is unknown too.
    ...(!extension || extension.installSourceMissing || !extension.installSources?.length ? [UNKNOWN_VALUE] : []),
  ];
  // Publisher IDs are case-insensitive, like the extension IDs they start.
  return { categories, publishers: [publisher?.toLowerCase() ?? UNKNOWN_VALUE], sources };
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

/** One value a person can pick in a filter dimension. */
export interface FacetOption {
  /** The value kept in MatrixFilters. */
  value: string;
  label: string;
  /** Tells apart options that share a label: the publisher ID when two publishers share a
   *  display name. */
  detail?: string;
  /** Rows that carry this value and match the view, the text, and every other dimension. This is
   *  not the number shown after picking it, because values in one dimension combine with "or". */
  count: number;
  selected: boolean;
}

export type Facets = Record<FilterDimension, FacetOption[]>;

/** Each dimension's name, singular. */
export const DIMENSION_NAMES: Readonly<Record<FilterDimension, string>> = Object.freeze({
  categories: 'Category',
  publishers: 'Publisher',
  sources: 'Source',
});

/** An option's full name: its label, plus the detail that tells it apart from a namesake. */
export function optionName(option: Pick<FacetOption, 'label' | 'detail'>): string {
  return option.detail ? `${option.label} (${option.detail})` : option.label;
}

/** A removable chip for one selected filter value. */
export interface FilterChip {
  dimension: FilterDimension;
  value: string;
  /** The visible text, as in "Publisher: Microsoft". */
  text: string;
  /** The accessible name of the chip's button, as in "Remove filter: Publisher Microsoft". */
  removeLabel: string;
}

/** One chip per selected value of each dimension. The view and the text box show their own state,
 * so they get no chip. */
export function activeFilterChips(filters: MatrixFilters, facets: Facets): FilterChip[] {
  return FILTER_DIMENSIONS.flatMap((dimension) =>
    filters[dimension].map((value) => {
      const found = facets[dimension].find((option) => option.value === value);
      const name = found ? optionName(found) : value || UNKNOWN_LABEL;
      const dimensionName = DIMENSION_NAMES[dimension];
      return { dimension, value, text: `${dimensionName}: ${name}`, removeLabel: `Remove filter: ${dimensionName} ${name}` };
    }),
  );
}

export interface ViewModel {
  /** Column headers in profile order. `name` is the plain name used in accessible names (from
   *  profileName); `label`/`tooltip` come from profileLabel. */
  profileNames: { id: string; name: string; label: string; tooltip?: string }[];
  workspace?: { name: string; kind: WorkspaceInventory['descriptor']['kind'] };
  rows: RowVm[];
  /** How many rows there are before any filter, for "42 of 180 extensions". */
  total: number;
  /** The values each filter dimension offers, in display order. */
  facets: Facets;
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
  const candidates: FacetCandidate[] = [];

  for (const id of allIds) {
    const extension = profileById.get(id);
    const workspaceStatus = workspaceById.get(id);
    const profileBacked = extension !== undefined;
    const displayName = extension?.displayName ?? workspaceStatus?.displayName ?? id;
    const applyToAllProfiles = extension?.applyToAllProfiles ?? false;
    const orphaned = extension?.orphaned ?? false;
    const publisher = extension?.publisher ?? workspaceStatus?.publisher;
    const publisherDisplayName = extension?.publisherDisplayName;
    const values = dimensionValues(extension, publisher);
    const inLens =
      (filters.view !== 'orphaned' || (profileBacked && orphaned)) &&
      (filters.view !== 'appliedToAllProfiles' || (profileBacked && applyToAllProfiles)) &&
      (!text || [id, displayName, publisher, publisherDisplayName].some((value) => value?.toLowerCase().includes(text)));
    candidates.push({ values, inLens, ...(publisherDisplayName ? { publisherDisplayName } : {}) });
    if (!inLens || !matchesDimensions(values, filters)) continue;

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
    facets: buildFacets(candidates, filters),
    warnings: inv.warnings,
    workspaceWarnings: workspace?.warnings ?? [],
  };
}

/** What the facet counts need to know about one row, whether or not the filters show it. */
interface FacetCandidate {
  values: Record<FilterDimension, string[]>;
  /** The row matches the view and the text, which every facet count applies. */
  inLens: boolean;
  publisherDisplayName?: string;
}

const SOURCE_ORDER = [...Object.keys(SOURCE_LABELS), OTHER_SOURCE, UNKNOWN_VALUE];

function buildFacets(candidates: FacetCandidate[], filters: MatrixFilters): Facets {
  const options = (dimension: FilterDimension) => facetCounts(dimension, candidates, filters);
  return {
    categories: sortWithUnknownLast(
      [...options('categories')].map(([value, count]) => option(value, value || UNKNOWN_LABEL, count, filters.categories)),
    ),
    publishers: publisherOptions(options('publishers'), candidates, filters),
    sources: [...options('sources')]
      .map(([value, count]) =>
        option(value, SOURCE_LABELS[value] ?? (value === UNKNOWN_VALUE ? UNKNOWN_LABEL : 'Other'), count, filters.sources),
      )
      .sort((a, b) => SOURCE_ORDER.indexOf(a.value) - SOURCE_ORDER.indexOf(b.value)),
  };
}

/**
 * Counts, for each value of `dimension`, the rows that carry it and match the view, the text, and
 * every other dimension. Lists every value some row carries, and every selected value even when no
 * row carries it any more, so a selection stays visible and removable.
 */
function facetCounts(dimension: FilterDimension, candidates: FacetCandidate[], filters: MatrixFilters): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of [...candidates.flatMap((c) => c.values[dimension]), ...filters[dimension]]) counts.set(value, 0);
  const others: MatrixFilters = { ...filters, [dimension]: [] };
  for (const candidate of candidates) {
    if (!candidate.inLens || !matchesDimensions(candidate.values, others)) continue;
    for (const value of new Set(candidate.values[dimension])) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function option(value: string, label: string, count: number, selected: readonly string[]): FacetOption {
  return { value, label, count, selected: selected.includes(value) };
}

function byLabel(a: FacetOption, b: FacetOption): number {
  return a.label.toLowerCase().localeCompare(b.label.toLowerCase()) || a.value.localeCompare(b.value);
}

function sortWithUnknownLast(options: FacetOption[]): FacetOption[] {
  return options.sort((a, b) => Number(a.value === UNKNOWN_VALUE) - Number(b.value === UNKNOWN_VALUE) || byLabel(a, b));
}

/** Publishers are labelled with the first display name any of their rows gives, else their ID.
 * Publishers that share a label show their ID too. */
function publisherOptions(counts: Map<string, number>, candidates: FacetCandidate[], filters: MatrixFilters): FacetOption[] {
  const names = new Map<string, string>();
  for (const candidate of candidates) {
    const id = candidate.values.publishers[0];
    if (id && candidate.publisherDisplayName && !names.has(id)) names.set(id, candidate.publisherDisplayName);
  }
  const options = [...counts].map(([value, count]) =>
    option(value, value === UNKNOWN_VALUE ? UNKNOWN_LABEL : (names.get(value) ?? value), count, filters.publishers),
  );
  const labelUses = new Map<string, number>();
  for (const { label } of options) labelUses.set(label, (labelUses.get(label) ?? 0) + 1);
  for (const o of options) if (o.value !== UNKNOWN_VALUE && (labelUses.get(o.label) ?? 0) > 1) o.detail = o.value;
  return sortWithUnknownLast(options);
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
