import { describe, expect, it } from 'vitest';
import { orphanCount } from '../../src/core/inventoryQueries';
import { buildViewModel } from '../../src/webview/render';
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

/** Each cell of a row as [what is known about the install, why the cell cannot act]. */
function cellStates(inventory: Inventory, extId: string): [string, string | undefined][] {
  const row = buildViewModel(inventory, { filter: '', chip: 'all' }).rows.find((r) => r.id === extId);
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

  it('keeps applied-to-all cells read-only, and inheriting profiles read-only for their own reason', () => {
    expect(cellStates(inv, 'pub.a')).toEqual([
      ['installed', 'appliedToAllProfiles'],
      ['installed', 'appliedToAllProfiles'],
      ['installed', 'inheritsDefault'],
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
    const vm = buildViewModel(inv, { filter: '', chip: 'all' });
    expect(vm.rows).toHaveLength(3);
    expect(vm.rows[0]?.cells).toHaveLength(3);
  });


  it('chip=orphaned shows only orphans', () => {
    const vm = buildViewModel(inv, { filter: '', chip: 'orphaned' });
    expect(vm.rows.map((r) => r.id)).toEqual(['pub.c']);
  });

  it('chip=appliedToAllProfiles shows only extensions applied to all profiles', () => {
    const vm = buildViewModel(inv, { filter: '', chip: 'appliedToAllProfiles' });
    expect(vm.rows.map((r) => r.id)).toEqual(['pub.a']);
  });

  it('filter matches id and displayName, case-insensitive', () => {
    expect(buildViewModel(inv, { filter: 'BETA', chip: 'all' }).rows.map((r) => r.id)).toEqual(['pub.b']);
    expect(buildViewModel(inv, { filter: 'pub.c', chip: 'all' }).rows.map((r) => r.id)).toEqual(['pub.c']);
  });

  it('counts orphans in the summary', () => {
    expect(orphanCount(inv)).toBe(1);
  });


  it('has no workspace column model when no workspace is loaded', () => {
    const vm = buildViewModel(inv, { filter: '', chip: 'all' });
    expect(vm.workspace).toBeUndefined();
    expect(vm.workspaceWarnings).toEqual([]);
    expect(vm.rows.every((row) => row.workspaceCell === undefined)).toBe(true);
  });

  it('adds a final, separate workspace model without adding a synthetic profile', () => {
    const vm = buildViewModel(inv, { filter: '', chip: 'all' }, workspaceWith([status('pub.a', 'enabled')]));
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
    const vm = buildViewModel(inv, { filter: '', chip: 'all' }, workspace);
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
    const vm = buildViewModel(inv, { filter: '', chip: 'all' }, workspace);
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

  it('does not expose workspace-only rows through profile-action chips', () => {
    const workspace = workspaceWith([
      status('local.only', 'unknown', {
        installedInActiveProfile: false,
        workspaceLocal: 'candidate',
        profileBacked: false,
      }),
    ]);
    expect(buildViewModel(inv, { filter: '', chip: 'orphaned' }, workspace).rows.map((row) => row.id)).toEqual([
      'pub.c',
    ]);
    expect(buildViewModel(inv, { filter: '', chip: 'appliedToAllProfiles' }, workspace).rows.map((row) => row.id)).toEqual([
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
    expect(buildViewModel(inv, { filter: 'SPECIAL', chip: 'all' }, workspace).rows.map((row) => row.id)).toEqual([
      'local.only',
    ]);
    expect(buildViewModel(inv, { filter: 'local.only', chip: 'all' }, workspace).rows.map((row) => row.id)).toEqual([
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
      const row = buildViewModel(inv, { filter: '', chip: 'all' }, workspaceWith([status('pub.a', state)])).rows.find(
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
    const vm = buildViewModel(inv, { filter: '', chip: 'all' }, workspaceWith([localOnly, bothSources]));
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
      const row = buildViewModel(inv, { filter: '', chip: 'all' }, workspaceWith([status('pub.a', state)])).rows.find(
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
    const vm = buildViewModel(inv, { filter: '', chip: 'all' }, workspaceWith([localOnly]));
    expect(vm.rows.find((row) => row.id === 'local.only')?.workspaceCell).toMatchObject({
      label: 'Workspace-local',
      offersEnablementGuide: true,
    });
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
    const headers = buildViewModel(withAgents, { filter: '', chip: 'all' }).profileNames;
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
