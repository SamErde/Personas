import { describe, expect, it } from 'vitest';
import { buildViewModel, formatBytes } from '../../src/webview/render';
import type { Inventory } from '../../src/core/types';

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
});

describe('formatBytes', () => {
  it('formats human-readable sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
