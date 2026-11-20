// The Extension Matrix's category, publisher, and source filters: one Filters disclosure button
// over native checkboxes (no ARIA menu, so no custom keyboard model), and a row of removable chips
// for the active values. These elements live outside the rebuilt table. The filter state itself is
// owned by main.ts, which hands every change back through `change` and then calls `update`.
import type { FilterDimension, MatrixFilters } from '../protocol';
import { activeFilterChips, DIMENSION_NAMES, FILTER_DIMENSIONS, optionName, type FacetOption, type Facets, type FilterChip } from './render';
import { nearestSurvivor } from './matrixFocus';
import { el } from './ui';

export interface FilterControls {
  /** The Filters disclosure button, for the toolbar. */
  toggle: HTMLButtonElement;
  /** The disclosed panel of filter groups. */
  panel: HTMLElement;
  /** The active-filter chips and Clear all. */
  chips: HTMLElement;
  /** Shows `filters`, with each value counted from `facets`. Without facets (before the first
   * inventory, or while the cleanup view is open) the last ones stay. */
  update(filters: MatrixFilters, facets?: Facets): void;
}

type DimensionChange = Partial<Pick<MatrixFilters, FilterDimension>>;

const EMPTY_FACETS: Facets = { categories: [], publishers: [], sources: [] };

/** The `data-filter-key` on an option's checkbox, which finds it again after a rebuild. */
const optionKey = (dimension: FilterDimension, value: string) => `${dimension}|${value}`;

/** The key of the control in `container` that has focus. As in preserveMatrixFocus, there is none
 * while the webview does not own focus, so a host refresh never pulls focus back from the editor. */
function focusedKeyIn(container: HTMLElement): string | undefined {
  const active = document.activeElement;
  return document.hasFocus() && active instanceof HTMLElement && container.contains(active) ? active.dataset['filterKey'] : undefined;
}

/** The `data-filter-key` of Clear all filters, which no option key can equal (those hold a '|'). */
const CLEAR_ALL_KEY = 'clear-all';

function findByKey(container: HTMLElement, key: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('[data-filter-key]')].find((node) => node.dataset['filterKey'] === key);
}

/** The publisher search matches an option's label or its ID. */
function matchesQuery(option: FacetOption, query: string): boolean {
  return !query || [option.label, option.value].some((text) => text.toLowerCase().includes(query));
}

export function createFilterControls(change: (next: DimensionChange) => void): FilterControls {
  let filters: MatrixFilters | undefined;
  let facets = EMPTY_FACETS;
  let chips: FilterChip[] = [];

  const panel = el('div', 'filter-panel');
  panel.id = 'matrix-filters';
  panel.hidden = true;

  const toggle = el('button', 'chip filters-toggle', 'Filters') as HTMLButtonElement;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', panel.id);
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });

  const lists = {} as Record<FilterDimension, HTMLElement>;
  const publisherSearch = document.createElement('input');
  publisherSearch.type = 'search';
  publisherSearch.className = 'filter-search';
  publisherSearch.placeholder = 'Search publishers…';
  publisherSearch.setAttribute('aria-label', 'Search publishers');
  // Narrows only the list of publishers to pick from; the filters stay as they are.
  publisherSearch.addEventListener('input', () => renderOptions('publishers'));

  for (const dimension of FILTER_DIMENSIONS) {
    const group = el('fieldset', 'filter-group');
    group.append(el('legend', '', DIMENSION_NAMES[dimension]));
    if (dimension === 'publishers') group.append(publisherSearch);
    lists[dimension] = el('div', 'filter-options');
    group.append(lists[dimension]);
    panel.append(group);
  }

  const chipRow = el('div', 'filter-chips');
  chipRow.setAttribute('role', 'group');
  chipRow.setAttribute('aria-label', 'Active filters');
  chipRow.hidden = true;

  function select(dimension: FilterDimension, value: string, on: boolean): void {
    if (!filters) return;
    const current = filters[dimension].filter((v) => v !== value);
    change({ [dimension]: on ? [...current, value] : current });
  }

  /** Rebuilds one group's checkboxes, keeping focus on the same value when one of them had it. */
  function renderOptions(dimension: FilterDimension): void {
    const list = lists[dimension];
    const focusedKey = focusedKeyIn(list);
    const query = dimension === 'publishers' ? publisherSearch.value.trim().toLowerCase() : '';
    const shown = facets[dimension].filter((option) => matchesQuery(option, query));
    list.replaceChildren(...shown.map((option) => optionRow(dimension, option)));
    if (shown.length === 0) list.append(el('p', 'filter-empty', query ? 'No publishers match.' : 'No values.'));
    // A value that is no longer listed leaves focus with the publisher search box, or for the
    // other groups with the Filters button, never on <body>.
    if (focusedKey) (findByKey(list, focusedKey) ?? (dimension === 'publishers' ? publisherSearch : toggle)).focus();
  }

  function optionRow(dimension: FilterDimension, option: FacetOption): HTMLElement {
    const row = el('label', 'filter-option');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = filters?.[dimension].includes(option.value) ?? option.selected;
    box.dataset['filterKey'] = optionKey(dimension, option.value);
    // The count is not the total after checking, since values in one group combine with "or".
    box.setAttribute('aria-label', `${optionName(option)}, ${option.count} ${option.count === 1 ? 'extension' : 'extensions'}`);
    box.addEventListener('change', () => select(dimension, option.value, box.checked));
    const count = el('span', 'filter-count', String(option.count));
    count.setAttribute('aria-hidden', 'true');
    row.append(box, el('span', 'filter-label', option.label));
    if (option.detail) row.append(el('span', 'filter-detail', option.detail));
    row.append(count);
    return row;
  }

  /** Rebuilds the chips. Focus on a chip stays on it, or moves to the chip after it, the one
   * before it, or the Filters button when the chip is gone, so it never drops to <body>. */
  function renderChips(): void {
    const focused = focusedKeyIn(chipRow);
    const before = [...chipRow.querySelectorAll<HTMLElement>('.filter-chip')].map((b) => b.dataset['filterKey'] ?? '');
    chipRow.replaceChildren();
    chipRow.hidden = chips.length === 0;
    for (const chip of chips) {
      const button = el('button', 'chip filter-chip', chip.text) as HTMLButtonElement;
      button.setAttribute('aria-label', chip.removeLabel);
      button.dataset['filterKey'] = optionKey(chip.dimension, chip.value);
      const mark = el('span', 'filter-chip-remove', '✕');
      mark.setAttribute('aria-hidden', 'true');
      button.append(mark);
      button.addEventListener('click', () => {
        button.focus(); // so the rebuild that follows moves focus on from this chip
        select(chip.dimension, chip.value, false);
      });
      chipRow.append(button);
    }
    if (chips.length > 0) {
      const clear = el('button', 'chip filter-clear', 'Clear all filters');
      clear.dataset['filterKey'] = CLEAR_ALL_KEY;
      clear.addEventListener('click', () => {
        clear.focus();
        change({ categories: [], publishers: [], sources: [] });
      });
      chipRow.append(clear);
    }
    if (focused !== undefined) restoreChipFocus(focused, before);
  }

  /** Focuses the control `focused` names after a rebuild, else the surviving chip nearest it. */
  function restoreChipFocus(focused: string, before: string[]): void {
    const rendered = (key: string) => findByKey(chipRow, key);
    const neighbour = nearestSurvivor(before, before.indexOf(focused), (key) => rendered(key) !== undefined);
    (rendered(focused) ?? (neighbour === undefined ? undefined : rendered(neighbour)) ?? toggle).focus();
  }

  return {
    toggle,
    panel,
    chips: chipRow,
    update(nextFilters, nextFacets) {
      filters = nextFilters;
      if (nextFacets) facets = nextFacets;
      chips = activeFilterChips(filters, facets);
      toggle.textContent = chips.length > 0 ? `Filters (${chips.length})` : 'Filters';
      for (const dimension of FILTER_DIMENSIONS) renderOptions(dimension);
      renderChips();
    },
  };
}
