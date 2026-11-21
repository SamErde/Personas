// @vitest-environment jsdom
// Drives the real Extension Matrix webview (main.ts) through host messages and checks the view
// chips, the text filter, the result announcement, and the view state kept by the host.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixToHost } from '../../src/protocol';
import { NO_FILTERS } from '../../src/webview/render';
import { faceted, inv, loadMatrixWebview, sendToMatrix as send } from './matrixDom';

const posted: MatrixToHost[] = [];

const filterInput = () => document.querySelector<HTMLInputElement>('.toolbar input[type="search"]')!;
const announcement = () => document.querySelector<HTMLElement>('[aria-live="polite"]')!.textContent;
const shownNames = () => [...document.querySelectorAll<HTMLElement>('.content tbody .name')].map((name) => name.textContent);

function viewChip(label: string): HTMLButtonElement {
  const chip = [...document.querySelectorAll<HTMLButtonElement>('.toolbar button')].find((b) => b.textContent === label);
  if (!chip) throw new Error(`No view chip labelled ${label}`);
  return chip;
}

function type(text: string): void {
  filterInput().value = text;
  filterInput().dispatchEvent(new Event('input'));
}

beforeAll(() => loadMatrixWebview(posted));

beforeEach(() => {
  vi.useFakeTimers();
  send({ type: 'cleanupResult', results: [] }); // back to the matrix if a test opened the cleanup view
  send({ type: 'viewState', state: { filters: NO_FILTERS, groupBy: 'none' } });
  send({ type: 'inventory', inventory: inv, icons: {} });
  posted.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('view chips', () => {
  it('are All and Applied to all profiles, in a group named View', () => {
    const group = document.querySelector<HTMLElement>('.toolbar [role="group"][aria-label="View"]');
    expect(group).not.toBeNull();
    expect([...group!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['All', 'Applied to all profiles']);
  });

  it('tell assistive technology which view is selected', () => {
    expect(viewChip('All').getAttribute('aria-pressed')).toBe('true');
    expect(viewChip('Applied to all profiles').getAttribute('aria-pressed')).toBe('false');

    viewChip('Applied to all profiles').click();

    expect(viewChip('All').getAttribute('aria-pressed')).toBe('false');
    expect(viewChip('Applied to all profiles').getAttribute('aria-pressed')).toBe('true');
    expect(shownNames()).toEqual(['Alpha']);
  });
});

describe('text filter', () => {
  it('applies after a short pause in typing', () => {
    type('Be');
    expect(shownNames()).toEqual(['Alpha', 'Beta']);

    vi.advanceTimersByTime(300);

    expect(shownNames()).toEqual(['Beta']);
  });
});

describe('result announcement', () => {
  it('announces how many extensions are shown after a filter change', () => {
    viewChip('Applied to all profiles').click();
    expect(announcement()).toBe('1 of 2 extensions');

    type('zzz');
    vi.advanceTimersByTime(300);
    expect(announcement()).toBe('0 of 2 extensions');
  });

  it('leaves no stale count behind once the cleanup view opens', () => {
    viewChip('Applied to all profiles').click();
    expect(announcement()).toBe('1 of 2 extensions');

    send({ type: 'orphans', orphans: [] });
    expect(announcement()).toBe('');

    viewChip('All').click(); // a filter change while cleanup is open still has no count to give
    expect(announcement()).toBe('');
  });

  it('stays quiet when the host refreshes the list', () => {
    viewChip('Applied to all profiles').click();
    viewChip('All').click();
    const before = announcement();

    send({ type: 'inventory', inventory: { ...inv, extensions: inv.extensions.slice(0, 1) }, icons: {} });

    expect(announcement()).toBe(before);
  });
});

describe('view state kept by the host', () => {
  it('is sent to the host when the view changes, and on every keystroke so a quick close keeps the text', () => {
    viewChip('Applied to all profiles').click();
    type('Be');

    expect(posted).toEqual([
      { type: 'viewState', state: { filters: { ...NO_FILTERS, view: 'appliedToAllProfiles' }, groupBy: 'none' } },
      { type: 'viewState', state: { filters: { ...NO_FILTERS, view: 'appliedToAllProfiles', text: 'Be' }, groupBy: 'none' } },
    ]);
  });

  it('is not sent again by a typing pause that a view change already applied', () => {
    type('Be');
    viewChip('Applied to all profiles').click();
    posted.length = 0;

    vi.advanceTimersByTime(300);

    expect(posted).toEqual([]);
  });

  it('is restored from the host into the chips, the filter box, and the table', () => {
    send({ type: 'viewState', state: { filters: { ...NO_FILTERS, view: 'appliedToAllProfiles', text: 'Al' }, groupBy: 'none' } });

    expect(filterInput().value).toBe('Al');
    expect(viewChip('Applied to all profiles').getAttribute('aria-pressed')).toBe('true');
    expect(shownNames()).toEqual(['Alpha']);
    expect(posted).toEqual([]);
  });
});

// --- Category, publisher, and source filters ----------------------------------------------------

const filtersButton = () => document.querySelector<HTMLButtonElement>('.toolbar button[aria-controls="matrix-filters"]')!;
const filterPanel = () => document.getElementById(filtersButton().getAttribute('aria-controls')!)!;
const chipRow = () => document.querySelector<HTMLElement>('.filter-chips')!;
const chipButtons = () => [...chipRow().querySelectorAll<HTMLButtonElement>('button')];
const chipNames = () => chipButtons().map((b) => b.getAttribute('aria-label') ?? b.textContent);
const publisherSearch = () => filterPanel().querySelector<HTMLInputElement>('input[type="search"]')!;

function group(legend: string): HTMLFieldSetElement {
  const found = [...filterPanel().querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === legend);
  if (!found) throw new Error(`No filter group ${legend}`);
  return found;
}

/** Each option in a filter group as its accessible name, with a * when checked. */
function options(legend: string): string[] {
  return [...group(legend).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(
    (box) => `${box.getAttribute('aria-label')}${box.checked ? ' *' : ''}`,
  );
}

function option(legend: string, label: string): HTMLInputElement {
  const box = [...group(legend).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((b) =>
    b.getAttribute('aria-label')?.startsWith(`${label},`),
  );
  if (!box) throw new Error(`No ${legend} option ${label}; options are ${options(legend).join(' | ')}`);
  return box;
}

function chip(name: string): HTMLButtonElement {
  const found = chipButtons().find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name);
  if (!found) throw new Error(`No chip ${name}; chips are ${chipNames().join(' | ')}`);
  return found;
}

/** Clicks a control the way a keyboard user does: focus first, then activate. */
function press(control: HTMLElement): void {
  control.focus();
  control.click();
}

function searchPublishers(text: string): void {
  publisherSearch().value = text;
  publisherSearch().dispatchEvent(new Event('input'));
}

describe('filter groups', () => {
  beforeEach(() => {
    send({ type: 'inventory', inventory: faceted, icons: {} });
    if (filtersButton().getAttribute('aria-expanded') === 'true') filtersButton().click();
    searchPublishers('');
    posted.length = 0;
  });

  it('open from one Filters disclosure button that exposes its expanded state', () => {
    expect(filtersButton().textContent).toBe('Filters');
    expect(filtersButton().getAttribute('aria-expanded')).toBe('false');
    expect(filterPanel().hidden).toBe(true);

    filtersButton().click();

    expect(filtersButton().getAttribute('aria-expanded')).toBe('true');
    expect(filterPanel().hidden).toBe(false);
    expect([...filterPanel().querySelectorAll('legend')].map((l) => l.textContent)).toEqual(['Category', 'Publisher', 'Source']);
    expect(posted).toEqual([]);
  });

  it('list each value as a native checkbox named with how many extensions carry it', () => {
    expect(options('Category')).toEqual(['Linters, 2 extensions', 'Themes, 1 extension', 'Unknown, 1 extension']);
    expect(options('Publisher')).toEqual(['Contoso Ltd, 1 extension', 'fabrikam, 1 extension', 'Unknown, 1 extension']);
    expect(options('Source')).toEqual(['Marketplace, 2 extensions', 'VSIX, 1 extension', 'Unknown, 1 extension']);
  });

  it('narrow the table when a value is checked, keep the view state, announce the count, and add a chip', () => {
    filtersButton().click();
    press(option('Category', 'Themes'));

    expect(shownNames()).toEqual(['Alpha']);
    expect(posted).toEqual([{ type: 'viewState', state: { filters: { ...NO_FILTERS, categories: ['Themes'] }, groupBy: 'none' } }]);
    expect(announcement()).toBe('1 of 3 extensions');
    expect(chipNames()).toEqual(['Remove filter: Category Themes', 'Clear all filters']);
    expect(filtersButton().textContent).toBe('Filters (1)');
  });

  it('keep focus on the checked value while its group is rebuilt', () => {
    filtersButton().click();
    press(option('Category', 'Themes'));

    expect(document.activeElement).toBe(option('Category', 'Themes'));
    expect(option('Category', 'Themes').checked).toBe(true);
  });

  it('count each value under the other active filters', () => {
    press(option('Publisher', 'fabrikam'));

    expect(options('Category')).toEqual(['Linters, 1 extension', 'Themes, 0 extensions', 'Unknown, 0 extensions']);
    expect(options('Publisher')).toEqual(['Contoso Ltd, 1 extension', 'fabrikam, 1 extension *', 'Unknown, 1 extension']);
  });

  it('let the publisher list be searched by name or ID without changing the filters', () => {
    searchPublishers('contoso');
    expect(options('Publisher')).toEqual(['Contoso Ltd, 1 extension']);

    searchPublishers('LTD');
    expect(options('Publisher')).toEqual(['Contoso Ltd, 1 extension']);

    searchPublishers('zzz');
    expect(options('Publisher')).toEqual([]);
    expect(group('Publisher').textContent).toContain('No publishers match');
    expect(posted).toEqual([]);
  });
});

describe('active-filter chips', () => {
  beforeEach(() => {
    send({ type: 'inventory', inventory: faceted, icons: {} });
    send({ type: 'viewState', state: { filters: { ...NO_FILTERS, categories: ['Linters'], publishers: ['fabrikam'], sources: ['vsix'] }, groupBy: 'none' } });
    searchPublishers('');
    posted.length = 0;
  });

  it('come back with the checkboxes and the table when the host restores the view state, without being sent back', () => {
    expect(chipNames()).toEqual([
      'Remove filter: Category Linters',
      'Remove filter: Publisher fabrikam',
      'Remove filter: Source VSIX',
      'Clear all filters',
    ]);
    expect(option('Source', 'VSIX').checked).toBe(true);
    expect(shownNames()).toEqual(['Beta']);
    expect(filtersButton().textContent).toBe('Filters (3)');
    expect(posted).toEqual([]);
  });

  it('remove their filter, announce the new count, and move focus to the next chip, the previous one, then the Filters button', () => {
    press(chip('Remove filter: Publisher fabrikam'));

    expect(posted).toEqual([
      { type: 'viewState', state: { filters: { ...NO_FILTERS, categories: ['Linters'], sources: ['vsix'] }, groupBy: 'none' } },
    ]);
    expect(announcement()).toBe('1 of 3 extensions');
    expect(option('Publisher', 'fabrikam').checked).toBe(false);
    expect(document.activeElement).toBe(chip('Remove filter: Source VSIX'));

    press(chip('Remove filter: Source VSIX'));
    expect(shownNames()).toEqual(['Alpha', 'Beta']);
    expect(announcement()).toBe('2 of 3 extensions');
    expect(document.activeElement).toBe(chip('Remove filter: Category Linters'));

    press(chip('Remove filter: Category Linters'));
    expect(announcement()).toBe('3 of 3 extensions');
    expect(chipRow().hidden).toBe(true);
    expect(document.activeElement).toBe(filtersButton());
    expect(filtersButton().textContent).toBe('Filters');
  });

  it('keep focus on the same chip when the host refreshes the list', () => {
    chip('Remove filter: Source VSIX').focus();
    send({ type: 'inventory', inventory: faceted, icons: {} });
    expect(document.activeElement).toBe(chip('Remove filter: Source VSIX'));

    chip('Clear all filters').focus();
    send({ type: 'inventory', inventory: faceted, icons: {} });
    expect(document.activeElement).toBe(chip('Clear all filters'));
  });

  it('move focus to a neighbouring chip when a refresh removes the focused one', () => {
    chip('Remove filter: Publisher fabrikam').focus();
    send({ type: 'viewState', state: { filters: { ...NO_FILTERS, categories: ['Linters'], sources: ['vsix'] }, groupBy: 'none' } });
    expect(document.activeElement).toBe(chip('Remove filter: Source VSIX'));
  });

  it('are all cleared by Clear all filters, which keeps the view and the text and focuses the Filters button', () => {
    send({
      type: 'viewState',
      state: { filters: { ...NO_FILTERS, view: 'appliedToAllProfiles', text: 'a', categories: ['Linters'], sources: ['vsix'] }, groupBy: 'none' },
    });

    press(chip('Clear all filters'));

    expect(posted).toEqual([{ type: 'viewState', state: { filters: { ...NO_FILTERS, view: 'appliedToAllProfiles', text: 'a' }, groupBy: 'none' } }]);
    expect(chipRow().hidden).toBe(true);
    expect(document.activeElement).toBe(filtersButton());
    expect(announcement()).toBe('1 of 3 extensions');
  });
});
