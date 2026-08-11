import { describe, expect, it } from 'vitest';
import { buildViewModel, formatBytes, supportsProfileActions } from '../../src/webview/render';
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
    localExtensions: [],
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
    runtimeSource: state === 'enabled' ? 'profile' : 'unknown',
    profileBacked: inv.extensions.some((extension) => extension.id === id),
    reason: `${state} evidence`,
    ...options,
  };
}

describe('buildViewModel', () => {
  it('produces one row per extension and one cell per profile', () => {
    const vm = buildViewModel(inv, { filter: '', chip: 'all' });
    expect(vm.rows).toHaveLength(3);
    expect(vm.rows[0]?.cells).toHaveLength(3);
  });

  it('marks inherited cells read-only', () => {
    const vm = buildViewModel(inv, { filter: '', chip: 'all' });
    const betaAgentsCell = vm.rows.find((r) => r.extId === 'pub.b')?.cells[2];
    expect(betaAgentsCell?.inherited).toBe(true);
  });

  it('chip=orphaned shows only orphans', () => {
    const vm = buildViewModel(inv, { filter: '', chip: 'orphaned' });
    expect(vm.rows.map((r) => r.extId)).toEqual(['pub.c']);
  });

  it('chip=allProfiles shows only app-scoped extensions', () => {
    const vm = buildViewModel(inv, { filter: '', chip: 'allProfiles' });
    expect(vm.rows.map((r) => r.extId)).toEqual(['pub.a']);
  });

  it('filter matches id and displayName, case-insensitive', () => {
    expect(buildViewModel(inv, { filter: 'BETA', chip: 'all' }).rows.map((r) => r.extId)).toEqual(['pub.b']);
    expect(buildViewModel(inv, { filter: 'pub.c', chip: 'all' }).rows.map((r) => r.extId)).toEqual(['pub.c']);
  });

  it('counts orphans in the summary', () => {
    expect(buildViewModel(inv, { filter: '', chip: 'all' }).orphanCount).toBe(1);
  });

  it('disables cells for profiles named in parse warnings', () => {
    const warned: Inventory = {
      ...inv,
      warnings: [{ file: 'profiles/aaa/extensions.json', message: 'bad', affectedProfileIds: ['aaa'] }],
    };
    const vm = buildViewModel(warned, { filter: '', chip: 'all' });
    expect(vm.rows[0]?.cells.map((c) => c.disabled)).toEqual([false, true, false]);
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
    expect(vm.rows.find((row) => row.extId === 'pub.a')?.workspaceCell).toMatchObject({
      state: 'enabled',
      label: 'Enabled',
      symbol: '✓',
    });
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
    const row = vm.rows.find((item) => item.extId === 'local.only');
    expect(row).toMatchObject({
      displayName: 'Local Fixture',
      profileBacked: false,
      applyToAllProfiles: false,
      orphaned: false,
      sourceLabel: 'Workspace-local candidate',
    });
    expect(row?.cells).toHaveLength(inv.profiles.length);
    expect(row?.cells.every((cell) => cell.workspaceOnly && !cell.installed)).toBe(true);
    expect(row?.workspaceCell).toMatchObject({ state: 'unknown', label: 'Unknown', symbol: '?' });
    expect(row && supportsProfileActions(row)).toBe(false);
  });

  it('does not expose workspace-only rows through profile-action chips', () => {
    const workspace = workspaceWith([
      status('local.only', 'unknown', {
        installedInActiveProfile: false,
        workspaceLocal: 'candidate',
        profileBacked: false,
      }),
    ]);
    expect(buildViewModel(inv, { filter: '', chip: 'orphaned' }, workspace).rows.map((row) => row.extId)).toEqual([
      'pub.c',
    ]);
    expect(buildViewModel(inv, { filter: '', chip: 'allProfiles' }, workspace).rows.map((row) => row.extId)).toEqual([
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
    expect(buildViewModel(inv, { filter: 'SPECIAL', chip: 'all' }, workspace).rows.map((row) => row.extId)).toEqual([
      'local.only',
    ]);
    expect(buildViewModel(inv, { filter: 'local.only', chip: 'all' }, workspace).rows.map((row) => row.extId)).toEqual([
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
        (item) => item.extId === 'pub.a',
      );
      expect(row?.workspaceCell).toMatchObject({ state, label, symbol });
      expect(row?.workspaceCell?.tooltip).toContain(label);
    },
  );

  it('uses Workspace-local only for a local effective copy absent from the active profile', () => {
    const localOnly = status('local.only', 'enabled', {
      installedInActiveProfile: false,
      workspaceLocal: 'installed',
      runtimeSource: 'workspace',
      profileBacked: false,
    });
    const bothSources = status('pub.a', 'enabled', {
      installedInActiveProfile: true,
      workspaceLocal: 'installed',
      runtimeSource: 'workspace',
    });
    const vm = buildViewModel(inv, { filter: '', chip: 'all' }, workspaceWith([localOnly, bothSources]));
    expect(vm.rows.find((row) => row.extId === 'local.only')?.workspaceCell?.label).toBe('Workspace-local');
    expect(vm.rows.find((row) => row.extId === 'pub.a')?.workspaceCell?.label).toBe('Enabled');
  });
});

describe('formatBytes', () => {
  it('formats human-readable sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
