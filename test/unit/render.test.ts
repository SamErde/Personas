import { describe, expect, it } from 'vitest';
import { orphanCount } from '../../src/core/inventoryQueries';
import type { FilterDimension, MatrixFilters } from '../../src/protocol';
import { activeFilterChips, buildViewModel, NO_FILTERS, OTHER_SOURCE, UNKNOWN_VALUE } from '../../src/webview/render';
import { formatBytes } from '../../src/webview/ui';
import type { Inventory, WorkspaceExtensionStatus, WorkspaceInventory } from '../../src/core/types';

const inv: Inventory = {
  profiles: [
    { id: 'default', name: 'Default', isDefault: true, inheritsDefaultExtensions: false },
    { id: 'aaa', name: 'Work', isDefault: false, inheritsDefaultExtensions: false },
    { id: 'bbb', name: 'Agents', isDefault: false, inheritsDefaultExtensions: true },
  ],
  extensions: [
    { id: 'pub.a', displayName: 'Alpha', versions: [{ version: '1.0.0', folderName: 'pub.a-1.0.0', fsPath: '/x/pub.a-1.0.0' }], applyToAllProfiles: true, installedIn: ['default', 'aaa', 'bbb'], orphaned: false },
    { id: 'pub.b', displayName: 'Beta', versions: [], applyToAllProfiles: false, installedIn: ['aaa'], orphaned: false },
    { id: 'pub.c', displayName: 'Gone', versions: [{ version: '2.0.0', folderName: 'pub.c-2.0.0', fsPath: '/x/pub.c-2.0.0' }], applyToAllProfiles: false, installedIn: [], orphaned: true },
  ],
  warnings: [],
};

function workspaceWith(statuses: WorkspaceExtensionStatus[]): WorkspaceInventory {
  return {
    descriptor: {
      name: 'Shared workspace',
      kind: 'workspace',
      associationUri: 'file:///shared.code-workspace',
      rootFsPaths: ['/repo'],
    },
    activeProfileId: 'aaa',
    activeProfileName: 'Work',
    extensions: statuses,
    warnings: ['association evidence is incomplete'],
  };
}

function status(
  id: string,
  state: WorkspaceExtensionStatus['state'],
  options?: Partial<WorkspaceExtensionStatus>,
): WorkspaceExtensionStatus {
  return {
    id,
    displayName: id,
    state,
    installedInActiveProfile: state === 'notInstalledInProfile' ? false : true,
    workspaceLocal: 'none',
    profileBacked: inv.extensions.some((extension) => extension.id === id),
    reason: `${state} evidence`,
    ...options,
  };
}

/** Lists each cell of a row as [what is known about the install, why the cell cannot act]. */
function cellStates(inventory: Inventory, extId: string): [string, string | undefined][] {
  const row = buildViewModel(inventory, NO_FILTERS).rows.find((r) => r.id === extId);
  if (!row) throw new Error(`No row for ${extId}`);
  return row.cells.map((cell) => [cell.install, cell.readOnlyReason]);
}

describe('cell knowledge and actions', () => {
  it('leaves directly installed cells writable, with what is installed known', () => {
    expect(cellStates(inv, 'pub.b')).toEqual([
      ['notInstalled', undefined],
      ['installed', undefined],
      ['notInstalled', 'inheritsDefault'],
    ]);
  });

  it('keeps applied-to-all cells read-only in every profile, including ones that use Default', () => {
    expect(cellStates(inv, 'pub.a')).toEqual([
      ['installed', 'appliedToAllProfiles'],
      ['installed', 'appliedToAllProfiles'],
      ['installed', 'appliedToAllProfiles'],
    ]);
  });

  it('keeps the install known when only the profile registry could not be read', () => {
    const unreadableRegistry: Inventory = {
      ...inv,
      warnings: [
        { file: 'globalStorage/storage.json', message: 'bad', affectedProfileIds: ['default', 'aaa', 'bbb'], kind: 'profileRegistry' },
      ],
    };
    expect(cellStates(unreadableRegistry, 'pub.b')).toEqual([
      ['notInstalled', 'profileRegistry'],
      ['installed', 'profileRegistry'],
      ['notInstalled', 'inheritsDefault'],
    ]);
  });

  it('marks the install as unknown, not missing, when a profile list could not be read', () => {
    const unreadableWork: Inventory = {
      ...inv,
      warnings: [{ file: 'profiles/aaa/extensions.json', message: 'bad', affectedProfileIds: ['aaa'] }],
    };
    expect(cellStates(unreadableWork, 'pub.b')).toEqual([
      ['notInstalled', undefined],
      ['unknown', 'unreadable'],
      ['notInstalled', 'inheritsDefault'],
    ]);
  });

  it('marks profiles that inherit an unreadable Default as unknown too', () => {
    const unreadableDefault: Inventory = {
      ...inv,
      warnings: [{ file: 'extensions.json (default profile)', message: 'bad', affectedProfileIds: ['default'] }],
    };
    expect(cellStates(unreadableDefault, 'pub.b')).toEqual([
      ['unknown', 'unreadable'],
      ['installed', undefined],
      ['unknown', 'inheritsDefault'],
    ]);
  });

  it('keeps the install known when a duplicate name is what blocks changes', () => {
    const duplicateWork: Inventory = {
      ...inv,
      warnings: [{ file: 'globalStorage/storage.json', message: 'dup', affectedProfileIds: ['aaa'], kind: 'duplicateName' }],
    };
    expect(cellStates(duplicateWork, 'pub.b')).toEqual([
      ['notInstalled', undefined],
      ['installed', 'duplicateName'],
      ['notInstalled', 'inheritsDefault'],
    ]);
  });
});

describe('buildViewModel', () => {
  it('produces one row per extension and one cell per profile', () => {
    const vm = buildViewModel(inv, NO_FILTERS);
    expect(vm.rows).toHaveLength(3);
    expect(vm.rows[0]?.cells).toHaveLength(3);
  });

  it('the Orphaned view shows only orphans', () => {
    const vm = buildViewModel(inv, { ...NO_FILTERS, view: 'orphaned' });
    expect(vm.rows.map((r) => r.id)).toEqual(['pub.c']);
  });

  it('the Applied to all profiles view shows only extensions applied to all profiles', () => {
    const vm = buildViewModel(inv, { ...NO_FILTERS, view: 'appliedToAllProfiles' });
    expect(vm.rows.map((r) => r.id)).toEqual(['pub.a']);
  });

  it('filter matches id and displayName, case-insensitive', () => {
    expect(buildViewModel(inv, { ...NO_FILTERS, text: 'BETA' }).rows.map((r) => r.id)).toEqual(['pub.b']);
    expect(buildViewModel(inv, { ...NO_FILTERS, text: 'pub.c' }).rows.map((r) => r.id)).toEqual(['pub.c']);
  });

  it('text search matches the publisher ID and display name', () => {
    const published: Inventory = {
      ...inv,
      extensions: inv.extensions.map((e) =>
        e.id === 'pub.b' ? { ...e, publisher: 'contoso', publisherDisplayName: 'Contoso Tools' } : e,
      ),
    };
    expect(buildViewModel(published, { ...NO_FILTERS, text: 'CONTOSO' }).rows.map((r) => r.id)).toEqual(['pub.b']);
    expect(buildViewModel(published, { ...NO_FILTERS, text: 'so tool' }).rows.map((r) => r.id)).toEqual(['pub.b']);
  });

  it('counts orphans in the summary', () => {
    expect(orphanCount(inv)).toBe(1);
  });

  it('has no workspace column model when no workspace is loaded', () => {
    const vm = buildViewModel(inv, NO_FILTERS);
    expect(vm.workspace).toBeUndefined();
    expect(vm.workspaceWarnings).toEqual([]);
    expect(vm.rows.every((row) => row.workspaceCell === undefined)).toBe(true);
  });

  it('adds a final, separate workspace model without adding a synthetic profile', () => {
    const vm = buildViewModel(inv, NO_FILTERS, workspaceWith([status('pub.a', 'enabled')]));
    expect(vm.profileNames.map((profile) => profile.id)).toEqual(['default', 'aaa', 'bbb']);
    expect(vm.workspace).toEqual({ name: 'Shared workspace', kind: 'workspace' });
    expect(vm.workspaceWarnings).toEqual(['association evidence is incomplete']);
    expect(vm.rows.find((row) => row.id === 'pub.a')?.workspaceCell).toMatchObject({
      state: 'enabled',
      label: 'Enabled',
      symbol: '✓',
    });
  });

  it('uses the workspace-resolved active version instead of the last enumerated disk version', () => {
    const workspace = workspaceWith([
      status('pub.a', 'enabled', { version: '9.0.0' }),
    ]);
    const vm = buildViewModel(inv, NO_FILTERS, workspace);
    expect(vm.rows.find((row) => row.id === 'pub.a')?.version).toBe('9.0.0');
  });

  it('unions workspace-only rows and makes every profile cell read-only', () => {
    const workspace = workspaceWith([
      status('local.only', 'unknown', {
        displayName: 'Local Fixture',
        installedInActiveProfile: false,
        workspaceLocal: 'candidate',
        profileBacked: false,
      }),
    ]);
    const vm = buildViewModel(inv, NO_FILTERS, workspace);
    const row = vm.rows.find((item) => item.id === 'local.only');
    expect(row).toMatchObject({
      displayName: 'Local Fixture',
      profileBacked: false,
      applyToAllProfiles: false,
      orphaned: false,
      sourceLabel: 'Workspace-local candidate',
    });
    expect(row?.cells).toHaveLength(inv.profiles.length);
    expect(row?.cells.every((cell) => cell.readOnlyReason === 'workspaceOnly' && cell.install === 'notInstalled')).toBe(true);
    expect(row?.workspaceCell).toMatchObject({ state: 'unknown', label: 'Unknown', symbol: '?' });
  });

  it('does not expose workspace-only rows through the profile-backed views', () => {
    const workspace = workspaceWith([
      status('local.only', 'unknown', {
        installedInActiveProfile: false,
        workspaceLocal: 'candidate',
        profileBacked: false,
      }),
    ]);
    expect(buildViewModel(inv, { ...NO_FILTERS, view: 'orphaned' }, workspace).rows.map((row) => row.id)).toEqual([
      'pub.c',
    ]);
    expect(buildViewModel(inv, { ...NO_FILTERS, view: 'appliedToAllProfiles' }, workspace).rows.map((row) => row.id)).toEqual([
      'pub.a',
    ]);
  });

  it('filters workspace-only rows by id and display name', () => {
    const workspace = workspaceWith([
      status('local.only', 'unknown', {
        displayName: 'Special Workspace Fixture',
        installedInActiveProfile: false,
        workspaceLocal: 'candidate',
        profileBacked: false,
      }),
    ]);
    expect(buildViewModel(inv, { ...NO_FILTERS, text: 'SPECIAL' }, workspace).rows.map((row) => row.id)).toEqual([
      'local.only',
    ]);
    expect(buildViewModel(inv, { ...NO_FILTERS, text: 'local.only' }, workspace).rows.map((row) => row.id)).toEqual([
      'local.only',
    ]);
  });

  it.each([
    ['enabled', 'Enabled', '✓'],
    ['notEnabled', 'Not enabled', '○'],
    ['notInstalledInProfile', 'Not installed in profile', '—'],
    ['unknown', 'Unknown', '?'],
  ] satisfies [WorkspaceExtensionStatus['state'], string, string][])(
    'maps %s to exact accessible status text',
    (state, label, symbol) => {
      const row = buildViewModel(inv, NO_FILTERS, workspaceWith([status('pub.a', state)])).rows.find(
        (item) => item.id === 'pub.a',
      );
      expect(row?.workspaceCell).toMatchObject({ state, label, symbol });
      expect(row?.workspaceCell?.tooltip).toContain(label);
    },
  );

  it('uses Workspace-local only for a local effective copy absent from the active profile', () => {
    const localOnly = status('local.only', 'enabled', {
      installedInActiveProfile: false,
      workspaceLocal: 'installed',
      profileBacked: false,
    });
    const bothSources = status('pub.a', 'enabled', {
      installedInActiveProfile: true,
      workspaceLocal: 'installed',
    });
    const vm = buildViewModel(inv, NO_FILTERS, workspaceWith([localOnly, bothSources]));
    expect(vm.rows.find((row) => row.id === 'local.only')?.workspaceCell).toMatchObject({
      label: 'Workspace-local',
      symbol: '✓ W',
    });
    expect(vm.rows.find((row) => row.id === 'pub.a')?.workspaceCell?.label).toBe('Enabled');
  });

  it.each([
    ['enabled', true],
    ['notEnabled', true],
    ['notInstalledInProfile', false],
    ['unknown', false],
  ] satisfies [WorkspaceExtensionStatus['state'], boolean][])(
    'offers the workspace enablement hand-off for %s: %s',
    (state, offered) => {
      const row = buildViewModel(inv, NO_FILTERS, workspaceWith([status('pub.a', state)])).rows.find(
        (item) => item.id === 'pub.a',
      );
      expect(row?.workspaceCell?.offersEnablementGuide).toBe(offered);
    },
  );

  it('offers the workspace enablement hand-off for a Workspace-local extension', () => {
    const localOnly = status('local.only', 'enabled', {
      installedInActiveProfile: false,
      workspaceLocal: 'installed',
      profileBacked: false,
    });
    const vm = buildViewModel(inv, NO_FILTERS, workspaceWith([localOnly]));
    expect(vm.rows.find((row) => row.id === 'local.only')?.workspaceCell).toMatchObject({
      label: 'Workspace-local',
      offersEnablementGuide: true,
    });
  });
});

describe('filter dimensions', () => {
  // Alpha: contoso, Themes + Linters, from the Marketplace. Beta: fabrikam, Linters, from a VSIX in one
  // profile and the Marketplace in another. Gone: no publisher, no categories, no manifest entry.
  const faceted: Inventory = {
    ...inv,
    extensions: inv.extensions.map((e) => {
      if (e.id === 'pub.a') return { ...e, publisher: 'contoso', categories: ['Linters', 'Themes'], installSources: ['gallery'] };
      if (e.id === 'pub.b') return { ...e, publisher: 'fabrikam', categories: ['Linters'], installSources: ['gallery', 'vsix'] };
      return { ...e, installSourceMissing: true };
    }),
  };
  const ids = (filters: Partial<MatrixFilters>, workspace?: WorkspaceInventory) =>
    buildViewModel(faceted, { ...NO_FILTERS, ...filters }, workspace).rows.map((r) => r.id);

  it('matches any selected value within one dimension', () => {
    expect(ids({ publishers: ['contoso', 'fabrikam'] })).toEqual(['pub.a', 'pub.b']);
    expect(ids({ categories: ['Themes'] })).toEqual(['pub.a']);
    expect(ids({ sources: ['vsix'] })).toEqual(['pub.b']);
  });

  it('requires every dimension with a selection to match, including the view and the text', () => {
    expect(ids({ categories: ['Linters'], sources: ['vsix'] })).toEqual(['pub.b']);
    expect(ids({ categories: ['Linters'], publishers: ['contoso'], text: 'beta' })).toEqual([]);
    expect(ids({ view: 'appliedToAllProfiles', categories: ['Linters'] })).toEqual(['pub.a']);
    expect(ids({ view: 'orphaned', categories: ['Linters'] })).toEqual([]);
  });

  it('puts rows without publisher, categories, or install source under Unknown', () => {
    expect(ids({ publishers: [UNKNOWN_VALUE] })).toEqual(['pub.c']);
    expect(ids({ categories: [UNKNOWN_VALUE] })).toEqual(['pub.c']);
    expect(ids({ sources: [UNKNOWN_VALUE] })).toEqual(['pub.c']);
  });

  it('puts a workspace-only row under Unknown for categories and install source', () => {
    const workspace = workspaceWith([
      status('local.only', 'unknown', { installedInActiveProfile: false, workspaceLocal: 'candidate', profileBacked: false }),
    ]);
    expect(ids({ categories: [UNKNOWN_VALUE], sources: [UNKNOWN_VALUE] }, workspace)).toEqual(['pub.c', 'local.only']);
  });

  it('keeps cells of inheriting and unreadable profiles unchanged under a filter', () => {
    const unreadableDefault: Inventory = {
      ...faceted,
      warnings: [{ file: 'extensions.json (default profile)', message: 'bad', affectedProfileIds: ['default'] }],
    };
    const row = buildViewModel(unreadableDefault, { ...NO_FILTERS, publishers: ['fabrikam'] }).rows;
    expect(row.map((r) => r.id)).toEqual(['pub.b']);
    expect(row[0]?.cells.map((cell) => [cell.install, cell.readOnlyReason])).toEqual([
      ['unknown', 'unreadable'],
      ['installed', undefined],
      ['unknown', 'inheritsDefault'],
    ]);
  });

  it('puts install sources without a known label under Other', () => {
    const odd: Inventory = {
      ...faceted,
      extensions: faceted.extensions.map((e) =>
        e.id === 'pub.c' ? { ...e, installSources: ['resource', 'somethingNew'], installSourceMissing: undefined } : e,
      ),
    };
    const sourceIds = (sources: string[]) =>
      buildViewModel(odd, { ...NO_FILTERS, sources }).rows.map((r) => r.id);
    expect(sourceIds([OTHER_SOURCE])).toEqual(['pub.c']);
    expect(sourceIds(['vsix'])).toEqual(['pub.b']);
    expect(sourceIds([UNKNOWN_VALUE])).toEqual([]);
  });

  it('matches publishers by ID whatever the case written in package.json', () => {
    const mixed: Inventory = {
      ...faceted,
      extensions: faceted.extensions.map((e) => (e.id === 'pub.b' ? { ...e, publisher: 'Contoso' } : e)),
    };
    expect(buildViewModel(mixed, { ...NO_FILTERS, publishers: ['contoso'] }).rows.map((r) => r.id)).toEqual(['pub.a', 'pub.b']);
  });

  /** Each option of a dimension as [label, count], with a * after a selected one. */
  const facet = (dimension: FilterDimension, filters: Partial<MatrixFilters> = {}, inventory = faceted, workspace?: WorkspaceInventory) =>
    buildViewModel(inventory, { ...NO_FILTERS, ...filters }, workspace).facets[dimension].map(
      (option) => `${option.label}${option.selected ? '*' : ''} ${option.count}`,
    );

  it('lists every value of each dimension with how many rows carry it, Unknown last', () => {
    expect(facet('categories')).toEqual(['Linters 2', 'Themes 1', 'Unknown 1']);
    expect(facet('publishers')).toEqual(['contoso 1', 'fabrikam 1', 'Unknown 1']);
    expect(facet('sources')).toEqual(['Marketplace 2', 'VSIX 1', 'Unknown 1']);
  });

  it('counts each value under the view, the text, and the other dimensions, but not its own dimension', () => {
    expect(facet('categories', { categories: ['Themes'] })).toEqual(['Linters 2', 'Themes* 1', 'Unknown 1']);
    expect(facet('publishers', { categories: ['Themes'] })).toEqual(['contoso 1', 'fabrikam 0', 'Unknown 0']);
    expect(facet('sources', { categories: ['Themes'] })).toEqual(['Marketplace 1', 'VSIX 0', 'Unknown 0']);
    expect(facet('categories', { view: 'appliedToAllProfiles' })).toEqual(['Linters 1', 'Themes 1', 'Unknown 0']);
    expect(facet('categories', { text: 'beta' })).toEqual(['Linters 1', 'Themes 0', 'Unknown 0']);
  });

  it('counts a row with several install sources once under each of them', () => {
    const odd: Inventory = {
      ...faceted,
      extensions: faceted.extensions.map((e) =>
        e.id === 'pub.c' ? { ...e, installSources: ['resource', 'somethingNew'], installSourceMissing: undefined } : e,
      ),
    };
    expect(facet('sources', {}, odd)).toEqual(['Marketplace 2', 'VSIX 1', 'Other 1']);
    expect(facet('sources', { publishers: ['fabrikam'] }, odd)).toEqual(['Marketplace 1', 'VSIX 1', 'Other 0']);
  });

  it('keeps a selected value that no row carries any more, so it can still be cleared', () => {
    expect(facet('publishers', { publishers: ['retired'] })).toEqual(['contoso 1', 'fabrikam 1', 'retired* 0', 'Unknown 1']);
    expect(ids({ publishers: ['retired'] })).toEqual([]);
  });

  it('labels publishers by display name, adding the ID only where two publishers share a name', () => {
    const named: Inventory = {
      ...faceted,
      extensions: faceted.extensions.map((e) => {
        if (e.id === 'pub.a') return { ...e, publisher: 'ms-python', publisherDisplayName: 'Microsoft' };
        if (e.id === 'pub.b') return { ...e, publisher: 'ms-vscode', publisherDisplayName: 'Microsoft' };
        return { ...e, publisher: 'github', publisherDisplayName: 'GitHub' };
      }),
    };
    const options = buildViewModel(named, NO_FILTERS).facets.publishers;
    expect(options.map(({ value, label, detail }) => [value, label, detail])).toEqual([
      ['github', 'GitHub', undefined],
      ['ms-python', 'Microsoft', 'ms-python'],
      ['ms-vscode', 'Microsoft', 'ms-vscode'],
    ]);
  });

  it('counts a workspace-only row under its publisher and under Unknown for categories and source', () => {
    const workspace = workspaceWith([
      status('local.only', 'unknown', { publisher: 'contoso', installedInActiveProfile: false, workspaceLocal: 'candidate', profileBacked: false }),
    ]);
    expect(facet('publishers', {}, faceted, workspace)).toEqual(['contoso 2', 'fabrikam 1', 'Unknown 1']);
    expect(facet('categories', {}, faceted, workspace)).toEqual(['Linters 2', 'Themes 1', 'Unknown 2']);
    expect(facet('sources', {}, faceted, workspace)).toEqual(['Marketplace 2', 'VSIX 1', 'Unknown 2']);
  });

  it('counts an extension once, however many profiles have it directly or through Default', () => {
    // Beta is installed in Work only; adding it to Default also gives it to Agents, which uses Default.
    const inheritedToo: Inventory = {
      ...faceted,
      extensions: faceted.extensions.map((e) => (e.id === 'pub.b' ? { ...e, installedIn: ['default', 'aaa', 'bbb'] } : e)),
    };
    expect(facet('publishers', {}, inheritedToo)).toEqual(facet('publishers'));
    expect(facet('sources', {}, inheritedToo)).toEqual(['Marketplace 2', 'VSIX 1', 'Unknown 1']);
  });

  it('counts rows the same when a profile list is unreadable or a profile uses Default', () => {
    const unreadableDefault: Inventory = {
      ...faceted,
      warnings: [{ file: 'extensions.json (default profile)', message: 'bad', affectedProfileIds: ['default'] }],
    };
    expect(facet('categories', {}, unreadableDefault)).toEqual(facet('categories'));
    expect(facet('sources', {}, unreadableDefault)).toEqual(facet('sources'));
  });

  it('counts every row, before filters, as the total', () => {
    const vm = buildViewModel(faceted, { ...NO_FILTERS, view: 'orphaned' });
    expect(vm.rows).toHaveLength(1);
    expect(vm.total).toBe(3);
  });
});

describe('activeFilterChips', () => {
  it('names each selected value by dimension and label, in category, publisher, source order', () => {
    const named: Inventory = {
      ...inv,
      extensions: inv.extensions.map((e) => {
        if (e.id === 'pub.a') return { ...e, publisher: 'ms-python', publisherDisplayName: 'Microsoft', categories: ['Linters'] };
        if (e.id === 'pub.b') return { ...e, publisher: 'ms-vscode', publisherDisplayName: 'Microsoft' };
        return e;
      }),
    };
    const filters: MatrixFilters = {
      ...NO_FILTERS,
      view: 'orphaned',
      text: 'py',
      sources: [UNKNOWN_VALUE],
      publishers: ['ms-python'],
      categories: ['Linters'],
    };
    const chips = activeFilterChips(filters, buildViewModel(named, filters).facets);
    expect(chips).toEqual([
      { dimension: 'categories', value: 'Linters', text: 'Category: Linters', removeLabel: 'Remove filter: Category Linters' },
      {
        dimension: 'publishers',
        value: 'ms-python',
        text: 'Publisher: Microsoft (ms-python)',
        removeLabel: 'Remove filter: Publisher Microsoft (ms-python)',
      },
      { dimension: 'sources', value: UNKNOWN_VALUE, text: 'Source: Unknown', removeLabel: 'Remove filter: Source Unknown' },
    ]);
  });

  it('has no chips when no dimension has a selection', () => {
    expect(activeFilterChips({ ...NO_FILTERS, text: 'x' }, buildViewModel(inv, NO_FILTERS).facets)).toEqual([]);
  });
});

describe('buildViewModel profile headers', () => {
  it('labels each profile column, marking ones that use Default extensions and the Agents window', () => {
    const withAgents: Inventory = {
      ...inv,
      profiles: [
        ...inv.profiles,
        { id: 'builtin/agents', name: 'Agents', isDefault: false, inheritsDefaultExtensions: true },
      ],
    };
    const headers = buildViewModel(withAgents, NO_FILTERS).profileNames;
    expect(headers.map((h) => h.label)).toEqual(['Default', 'Work', '⤷ Agents', '⤷ Agents window']);
    expect(headers[0]?.tooltip).toBeUndefined();
    expect(headers[2]?.tooltip).toBe("Uses the Default profile's extensions.");
    expect(headers[3]?.tooltip).toContain('Agents window');
  });
});

describe('formatBytes', () => {
  it('formats human-readable sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
