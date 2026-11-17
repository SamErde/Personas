// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Inventory } from '../../src/core/types';
import { buildViewModel } from '../../src/webview/render';
import { renderMatrixTable, type MatrixTableHooks } from '../../src/webview/matrixTable';

const inv: Inventory = {
  profiles: [
    { id: 'default', name: 'Default', isDefault: true, inheritsDefaultExtensions: false },
    { id: 'aaa', name: 'Work', isDefault: false, inheritsDefaultExtensions: false },
    { id: 'bbb', name: 'Agents', isDefault: false, inheritsDefaultExtensions: true },
  ],
  extensions: [
    { id: 'pub.a', displayName: 'Alpha', versions: [], applyToAllProfiles: true, installedIn: ['default', 'aaa', 'bbb'], orphaned: false },
    { id: 'pub.b', displayName: 'Beta', versions: [], applyToAllProfiles: false, installedIn: ['aaa'], orphaned: false },
  ],
  warnings: [],
};

let toggles: { extId: string; profileId: string; install: boolean }[];
let pendingCells: Set<string>;

const hooks: MatrixTableHooks = {
  icon: () => document.createElement('span'),
  isPending: (extId, profileId) => pendingCells.has(`${extId}|${profileId}`),
  wireName: () => undefined,
  toggleCell: (extId, profileId, install) => toggles.push({ extId, profileId, install }),
  showApplyToAllProfilesGuide: () => undefined,
  showWorkspaceEnablementGuide: () => undefined,
};

function render(inventory: Inventory = inv): HTMLTableElement {
  const table = renderMatrixTable(buildViewModel(inventory, { filter: '', chip: 'all' }), hooks);
  document.body.replaceChildren(table);
  return table;
}

/** The body cell where an extension's row meets a profile's column, found through the table's
 * own header cells the way assistive technology pairs them. */
function cellAt(table: HTMLTableElement, extension: string, profileLabel: string): HTMLTableCellElement {
  const headers = [...(table.tHead?.rows[0]?.cells ?? [])].map((th) => th.textContent);
  const col = headers.indexOf(profileLabel);
  if (col < 0) throw new Error(`No column headed ${profileLabel}; headers are ${headers.join(', ')}`);
  const row = [...table.tBodies].flatMap((body) => [...body.rows]).find((tr) => tr.cells[0]?.textContent?.includes(extension));
  if (!row) throw new Error(`No row for ${extension}`);
  const cell = row.cells[col];
  if (!cell) throw new Error(`Row ${extension} has no cell in column ${profileLabel}`);
  return cell;
}

beforeEach(() => {
  document.body.replaceChildren();
  toggles = [];
  pendingCells = new Set();
});

describe('writable cells', () => {
  it('render a checkbox that keeps the native checked state and toggles the install', () => {
    const table = render();
    const work = cellAt(table, 'Beta', 'Work').querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const inDefault = cellAt(table, 'Beta', 'Default').querySelector<HTMLInputElement>('input[type="checkbox"]')!;

    expect(work.checked).toBe(true);
    expect(inDefault.checked).toBe(false);

    inDefault.click();
    expect(toggles).toEqual([{ extId: 'pub.b', profileId: 'default', install: true }]);
  });
});
