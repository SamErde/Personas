// @vitest-environment jsdom
// Drives the real Extension Matrix webview (main.ts) through host messages and checks the Group by
// control, the grouped table, the hover card's row in grouped order, and focus across groups.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Inventory } from '../../src/core/types';
import type { MatrixGroupBy, MatrixToHost } from '../../src/protocol';
import { NO_FILTERS } from '../../src/webview/render';
import { checkbox, faceted, loadMatrixWebview, nameOf, sendToMatrix as send, shownTable as table } from './matrixDom';

const posted: MatrixToHost[] = [];

/**
 * The faceted fixture plus "42 Snippets" (from zeta) and "Ägypten" (from Fabrikam). Sorted by name
 * the rows run 42 Snippets, Ägypten, Alpha, Beta, Gamma. Grouped by name, 42 Snippets moves to the
 * last group, "#". Grouped by publisher: Contoso Ltd (Alpha), fabrikam (Ägypten, Beta), zeta
 * (42 Snippets), Unknown (Gamma).
 */
const grouped: Inventory = {
  ...faceted,
  extensions: [
    ...faceted.extensions,
    { id: 'zeta.snippets', displayName: '42 Snippets', publisher: 'zeta', versions: [], applyToAllProfiles: false, installedIn: ['aaa'], orphaned: false },
    { id: 'fabrikam.egypt', displayName: 'Ägypten', publisher: 'fabrikam', versions: [], applyToAllProfiles: false, installedIn: [], orphaned: false },
  ],
};

const groupBySelect = () => document.querySelector<HTMLSelectElement>('.toolbar select')!;
const card = () => document.querySelector<HTMLElement>('.ext-card')!;
const shownNames = () => [...table().querySelectorAll<HTMLElement>('tbody .name')].map((name) => name.textContent);
const headings = () => [...table().querySelectorAll<HTMLElement>('tr.group-heading > th')].map((th) => th.textContent);

/** The table shows one list: no headings, every row in name order. */
function expectOneList(): void {
  expect(headings()).toEqual([]);
  expect(shownNames()).toEqual(['42 Snippets', 'Ägypten', 'Alpha', 'Beta', 'Gamma']);
}

function chooseGroupBy(value: MatrixGroupBy): void {
  groupBySelect().value = value;
  groupBySelect().dispatchEvent(new Event('change'));
}

beforeAll(() => loadMatrixWebview(posted));

beforeEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  send({ type: 'viewState', state: { filters: NO_FILTERS, groupBy: 'none' } });
  send({ type: 'inventory', inventory: grouped, icons: {} });
  posted.length = 0;
});

describe('the Group by control', () => {
  it('is a labelled select in the toolbar, in the Tab order, offering None, Name, and Publisher', () => {
    const select = groupBySelect();

    expect(select.labels?.[0]?.textContent).toMatch(/^Group by/);
    expect(select.tabIndex).toBeGreaterThanOrEqual(0);
    expect(select.disabled).toBe(false);
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['none', 'None'],
      ['name', 'Name'],
      ['publisher', 'Publisher'],
    ]);
    expect(select.value).toBe('none');
    expect(headings()).toEqual([]);
  });

  it('groups the table by name and keeps the choice with the host', () => {
    chooseGroupBy('name');

    expect(headings()).toEqual(['A, 2 extensions', 'B, 1 extension', 'G, 1 extension', '#, 1 extension']);
    expect(shownNames()).toEqual(['Ägypten', 'Alpha', 'Beta', 'Gamma', '42 Snippets']);
    expect(posted).toEqual([{ type: 'viewState', state: { filters: NO_FILTERS, groupBy: 'name' } }]);
  });

  it('groups the table by publisher, labelled as the filters label publishers', () => {
    chooseGroupBy('publisher');

    expect(headings()).toEqual(['Contoso Ltd, 1 extension', 'fabrikam, 2 extensions', 'zeta, 1 extension', 'Unknown, 1 extension']);
    expect(shownNames()).toEqual(['Alpha', 'Ägypten', 'Beta', '42 Snippets', 'Gamma']);
  });

  it('returns to one list for None', () => {
    chooseGroupBy('name');
    chooseGroupBy('none');

    expectOneList();
  });

  it("comes back from the host's view state for a reopened panel, without sending it back", () => {
    send({ type: 'viewState', state: { filters: NO_FILTERS, groupBy: 'publisher' } });

    expect(groupBySelect().value).toBe('publisher');
    expect(headings()[0]).toBe('Contoso Ltd, 1 extension');
    expect(posted).toEqual([]);
  });

  it('falls back to one list for a grouping it does not know', () => {
    send({ type: 'viewState', state: { filters: NO_FILTERS, groupBy: 'category' as MatrixGroupBy } });

    expect(groupBySelect().value).toBe('none');
    expectOneList();
  });

  it('keeps focus on itself when the grouping changes', () => {
    groupBySelect().focus();

    chooseGroupBy('name');

    expect(document.activeElement).toBe(groupBySelect());
  });
});

describe('the hover card in a grouped table', () => {
  it("keeps its extension's row highlighted in grouped order", () => {
    chooseGroupBy('name');
    nameOf('42 Snippets').focus(); // opens the card
    expect(card().hidden).toBe(false);
    (card().querySelector('button') as HTMLElement).focus(); // focus leaves the table for the card

    const highlighted = table().querySelector('tbody th.crosshair-label');
    expect(highlighted?.querySelector('.name')?.textContent).toBe('42 Snippets');
  });
});

describe('focus in a grouped table', () => {
  it('moves to the nearest row in grouped order when a filter change removes the focused row’s group', () => {
    chooseGroupBy('publisher');
    checkbox('42 Snippets', 'Work').focus();

    send({ type: 'viewState', state: { filters: { ...NO_FILTERS, publishers: ['contoso', 'fabrikam', ''] }, groupBy: 'publisher' } });

    expect(headings()).toEqual(['Contoso Ltd, 1 extension', 'fabrikam, 2 extensions', 'Unknown, 1 extension']);
    expect(document.activeElement).toBe(checkbox('Gamma', 'Work'));
  });

  it('moves to the nearest row in grouped order when a filter change empties the focused row’s group', () => {
    chooseGroupBy('name');
    nameOf('42 Snippets').focus();

    send({ type: 'viewState', state: { filters: { ...NO_FILTERS, publishers: ['contoso', 'fabrikam', ''] }, groupBy: 'name' } });

    expect(headings()).toEqual(['A, 2 extensions', 'B, 1 extension', 'G, 1 extension']);
    expect(document.activeElement).toBe(nameOf('Gamma'));
  });

  it('moves to the nearest row in grouped order when a refresh empties the focused row’s group', () => {
    chooseGroupBy('name');
    nameOf('42 Snippets').focus();

    send({ type: 'inventory', inventory: faceted, icons: {} });

    expect(headings()).not.toContain('#, 1 extension');
    expect(document.activeElement).toBe(nameOf('Gamma'));
  });

  it('never lands on a heading row', () => {
    chooseGroupBy('name');
    checkbox('Beta', 'Work').focus();

    send({ type: 'inventory', inventory: { ...grouped, extensions: grouped.extensions.filter((e) => e.id !== 'pub.b') }, icons: {} });

    expect(document.activeElement?.closest('tr')?.classList.contains('group-heading')).toBe(false);
    expect(document.activeElement).toBe(checkbox('Gamma', 'Work'));
  });
});
