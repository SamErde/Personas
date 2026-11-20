// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Inventory, WorkspaceInventory } from '../../src/core/types';
import { gridHitAt, paintCrosshair } from '../../src/webview/crosshair';
import { buildViewModel } from '../../src/webview/render';
import { renderMatrixLegend, renderMatrixTable, type MatrixTableHooks } from '../../src/webview/matrixTable';
import { cellAt, inv, withInherited } from './matrixDom';

let toggles: { extId: string; profileId: string; install: boolean }[];
let pendingCells: Set<string>;

const hooks: MatrixTableHooks = {
  icon: () => document.createElement('span'),
  isPending: (extId, profileId) => pendingCells.has(`${extId}|${profileId}`),
  attachHoverCard: () => undefined,
  toggleCell: (extId, profileId, install) => toggles.push({ extId, profileId, install }),
  showApplyToAllProfilesGuide: () => undefined,
  showWorkspaceEnablementGuide: () => undefined,
};

function render(inventory: Inventory = inv): HTMLTableElement {
  const table = renderMatrixTable(buildViewModel(inventory, { filter: '', chip: 'all' }), hooks);
  document.body.replaceChildren(table);
  return table;
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

describe('accessible names', () => {
  it('names each checkbox for the extension and profile it changes', () => {
    const table = render();

    expect(cellAt(table, 'Beta', 'Default').querySelector('input')!.getAttribute('aria-label')).toBe('Beta in Default');
    expect(cellAt(table, 'Beta', 'Work').querySelector('input')!.getAttribute('aria-label')).toBe('Beta in Work');
  });
});

describe('read-only cells', () => {
  const label = (cell: HTMLElement) => cell.getAttribute('aria-label');
  const glyph = (cell: HTMLElement) => cell.querySelector('.glyph');

  it('label their state with the extension and profile, since they have no checkbox', () => {
    const table = render();

    expect(label(cellAt(table, 'Alpha', 'Work'))).toBe('Alpha in Work: applied to all profiles');
    expect(label(cellAt(table, 'Alpha', '⤷ Shared'))).toBe('Alpha in Shared: applied to all profiles');
    expect(label(cellAt(render(withInherited), 'Gamma', '⤷ Shared'))).toBe('Gamma in Shared: installed through Default');
    expect(label(cellAt(table, 'Beta', '⤷ Shared'))).toBe("Beta in Shared: not installed, uses Default's extensions");
  });

  it('give each state a distinct glyph that assistive technology skips', () => {
    const unreadableWork: Inventory = {
      ...withInherited,
      warnings: [{ file: 'profiles/aaa/extensions.json', message: 'bad', affectedProfileIds: ['aaa'] }],
    };
    const table = render(unreadableWork);
    const glyphs = {
      appliedToAll: glyph(cellAt(table, 'Alpha', 'Default')),
      inherited: glyph(cellAt(table, 'Gamma', '⤷ Shared')),
      notInstalled: glyph(cellAt(table, 'Beta', '⤷ Shared')),
      unknown: glyph(cellAt(table, 'Beta', 'Work')),
    };

    const shapes = Object.values(glyphs).map((g) => g?.textContent);
    expect(new Set(shapes).size).toBe(4);
    expect(shapes.every((shape) => shape && shape.trim() !== '')).toBe(true);
    expect(Object.values(glyphs).every((g) => g?.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(label(cellAt(table, 'Beta', 'Work'))).toBe('Beta in Work: unknown, the extension list could not be read');
  });

  it('give the real reason a cell is disabled', () => {
    const duplicateWork: Inventory = {
      ...inv,
      warnings: [{ file: 'globalStorage/storage.json', message: 'dup', affectedProfileIds: ['aaa'], kind: 'duplicateName' }],
    };
    const work = cellAt(render(duplicateWork), 'Beta', 'Work');

    expect(work.querySelector('input')).toBeNull();
    expect(work.title).toMatch(/by name/);
    expect(work.title).not.toMatch(/could not be read/);
    expect(label(work)).toBe("Beta in Work: installed, can't change because the profile name is ambiguous");
  });

  it('say that profiles using an unreadable Default are unknown', () => {
    const unreadableDefault: Inventory = {
      ...inv,
      warnings: [{ file: 'extensions.json (default profile)', message: 'bad', affectedProfileIds: ['default'] }],
    };
    const shared = cellAt(render(unreadableDefault), 'Beta', '⤷ Shared');

    expect(label(shared)).toBe("Beta in Shared: unknown, Default's extension list could not be read");
    expect(shared.title).toMatch(/Default profile's extension list could not be read/);
  });

  it('carry their label as screen-reader text too, so the cell is never empty to a screen reader', () => {
    const table = render(withInherited);

    for (const cell of [cellAt(table, 'Alpha', 'Work'), cellAt(table, 'Gamma', '⤷ Shared'), cellAt(table, 'Beta', '⤷ Shared')]) {
      expect(cell.querySelector('.sr-only')?.textContent).toBe(label(cell));
    }
  });

  it('say why changes are disabled when only the profile registry could not be read', () => {
    const unreadableRegistry: Inventory = {
      ...inv,
      warnings: [
        { file: 'globalStorage/storage.json', message: 'bad', affectedProfileIds: ['default', 'aaa', 'bbb'], kind: 'profileRegistry' },
      ],
    };
    const work = cellAt(render(unreadableRegistry), 'Beta', 'Work');

    expect(work.querySelector('input')).toBeNull();
    expect(label(work)).toBe("Beta in Work: installed, can't change because the profile list could not be read");
    expect(work.title).not.toMatch(/extension list could not be read/);
  });

  it('mark every profile cell of a workspace-only row as read-only, even while a change is pending', () => {
    pendingCells.add('local.only|aaa');
    const workspace: WorkspaceInventory = {
      descriptor: { name: 'Repo', kind: 'folder', rootFsPaths: ['/repo'] },
      activeProfileId: 'aaa',
      activeProfileName: 'Work',
      extensions: [
        {
          id: 'local.only', displayName: 'Local Fixture', state: 'enabled', installedInActiveProfile: false,
          workspaceLocal: 'installed', profileBacked: false, reason: 'local copy',
        },
      ],
      warnings: [],
    };
    const table = renderMatrixTable(buildViewModel(inv, { filter: '', chip: 'all' }, workspace), hooks);
    document.body.replaceChildren(table);

    for (const profile of ['Default', 'Work', '⤷ Shared']) {
      const cell = cellAt(table, 'Local Fixture', profile);
      expect(cell.querySelector('input, .spinner')).toBeNull();
      expect(label(cell)).toMatch(/^Local Fixture in \w+: not in this profile, read-only workspace extension$/);
    }
  });

  it('keep a pending cell a focusable checkbox that names its cell, shows the current state, and says the change is in progress', () => {
    pendingCells.add('pub.b|aaa');
    const work = cellAt(render(), 'Beta', 'Work');
    const box = work.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

    expect(box.disabled).toBe(false); // a disabled control cannot hold focus
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(box.getAttribute('aria-label')).toBe('Beta in Work');
    expect(box.checked).toBe(true); // still installed until the host confirms the change
    const description = document.getElementById(box.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('change in progress');
    expect(work.querySelector('.spinner')?.getAttribute('aria-hidden')).toBe('true');

    box.focus();
    expect(document.activeElement).toBe(box);
    box.click();
    expect(box.checked).toBe(true);
    expect(toggles).toEqual([]);
  });

  it("name the Agents window profile for its window", () => {
    const withAgentsWindow: Inventory = {
      ...inv,
      profiles: [...inv.profiles, { id: 'builtin/agents', name: 'Agents', isDefault: false, inheritsDefaultExtensions: true }],
    };

    expect(label(cellAt(render(withAgentsWindow), 'Alpha', '⤷ Agents window'))).toBe('Alpha in Agents window: applied to all profiles');
  });
});

describe('focus keys', () => {
  it('name every focusable control by its extension and slot, so focus can find it after a rebuild', () => {
    const workspace: WorkspaceInventory = {
      descriptor: { name: 'Repo', kind: 'folder', rootFsPaths: ['/repo'] },
      activeProfileId: 'aaa',
      activeProfileName: 'Work',
      extensions: [
        { id: 'pub.b', displayName: 'Beta', state: 'notEnabled', installedInActiveProfile: true, workspaceLocal: 'none', profileBacked: true, reason: 'not enabled here' },
      ],
      warnings: [],
    };
    const table = renderMatrixTable(buildViewModel(inv, { filter: '', chip: 'all' }, workspace), hooks);
    document.body.replaceChildren(table);
    const keys = (extension: string) =>
      [...cellAt(table, extension, 'Extension').closest('tr')!.querySelectorAll<HTMLElement>('[data-focus-key]')].map(
        (node) => node.dataset['focusKey'],
      );

    expect(keys('Alpha').slice(0, 2)).toEqual(['pub.a|name', 'pub.a|all']);
    expect(keys('Beta')).toEqual(expect.arrayContaining(['pub.b|name', 'pub.b|profile:default', 'pub.b|profile:aaa']));
    expect(keys('Beta')).not.toContain('pub.b|profile:bbb'); // read-only cells are not controls
    // Every control in the table carries a key, and every keyed element is in the Tab order.
    expect(table.querySelectorAll('button:not([data-focus-key]), input:not([data-focus-key]), [tabindex]:not([data-focus-key])')).toHaveLength(0);
    for (const node of table.querySelectorAll<HTMLElement>('[data-focus-key]')) expect(node.tabIndex).toBeGreaterThanOrEqual(0);
  });
});

describe('legend', () => {
  it('explains every read-only glyph the table uses', () => {
    const table = render(withInherited);
    const legend = renderMatrixLegend();
    const entries = [...legend.querySelectorAll('li')].map((li) => [li.querySelector('.glyph')?.textContent, li.textContent]);

    for (const cell of [cellAt(table, 'Alpha', 'Work'), cellAt(table, 'Gamma', '⤷ Shared'), cellAt(table, 'Beta', '⤷ Shared')]) {
      expect(entries.map(([shape]) => shape)).toContain(cell.querySelector('.glyph')?.textContent);
    }
    expect(entries.map(([, text]) => text)).toEqual(expect.arrayContaining([expect.stringMatching(/Unknown/)]));
    expect(legend.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('table headers', () => {
  it('heads each row with its extension name and each column with its profile', () => {
    const table = render();
    const bodyRows = [...table.tBodies].flatMap((body) => [...body.rows]);

    expect(bodyRows.map((tr) => [tr.cells[0]?.tagName, tr.cells[0]?.getAttribute('scope'), tr.cells[0]?.textContent]))
      .toEqual([['TH', 'row', 'AlphaALL'], ['TH', 'row', 'Beta']]);
    expect([...table.tHead!.rows[0]!.cells].map((th) => th.getAttribute('scope'))).toEqual(['col', 'col', 'col', 'col']);
  });
});

describe('crosshair hit classification', () => {
  it('treats a row header as the extension name, not as a column header', () => {
    const table = render();
    const betaName = cellAt(table, 'Beta', 'Extension');

    expect(gridHitAt(betaName, table)).toEqual({ kind: 'name', row: 1 });
    expect(gridHitAt(betaName.querySelector('.name'), table)).toEqual({ kind: 'name', row: 1 });
    expect(gridHitAt(table.tHead!.rows[0]!.cells[2]!, table)).toEqual({ kind: 'header', col: 2 });
    expect(gridHitAt(cellAt(table, 'Beta', 'Work').querySelector('input'), table)).toEqual({ kind: 'cell', row: 1, col: 2 });
  });

  it('ignores elements outside the table', () => {
    const table = render();
    const outside = document.createElement('button');
    document.body.append(outside);

    expect(gridHitAt(outside, table)).toBeUndefined();
  });
});

describe('crosshair highlight', () => {
  const classes = (cell: Element) => [...cell.classList].filter((c) => c.startsWith('crosshair'));

  it("marks the row header and the column header as labels, and outlines the cell where they cross", () => {
    const table = render();

    paintCrosshair(table, { row: 1, col: 2, outlineCell: true });

    expect(classes(cellAt(table, 'Beta', 'Extension'))).toEqual(['crosshair-label']);
    expect(classes(table.tHead!.rows[0]!.cells[2]!)).toEqual(['crosshair-label']);
    expect(classes(cellAt(table, 'Beta', 'Default'))).toEqual(['crosshair']);
    expect(classes(cellAt(table, 'Beta', 'Work'))).toEqual(['crosshair', 'crosshair-cell']);
    expect(classes(cellAt(table, 'Alpha', 'Work'))).toEqual(['crosshair']);
    expect(classes(cellAt(table, 'Alpha', 'Default'))).toEqual([]);
  });

  it('clears the previous highlight', () => {
    const table = render();
    paintCrosshair(table, { row: 1, col: 2, outlineCell: true });

    paintCrosshair(table, {});

    expect(table.querySelectorAll('.crosshair, .crosshair-label, .crosshair-cell')).toHaveLength(0);
  });
});
