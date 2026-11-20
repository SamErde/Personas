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
    const active = document.activeElement;
    // As in preserveMatrixFocus, nothing is restored while the webview does not own focus, so a
    // host refresh never pulls focus back from the editor.
    const focusedKey =
      document.hasFocus() && active instanceof HTMLElement && list.contains(active) ? active.dataset['filterKey'] : undefined;

    const query = dimension === 'publishers' ? publisherSearch.value.trim().toLowerCase() : '';
    const shown = facets[dimension].filter(
      (option) => !query || [option.label, option.value].some((text) => text.toLowerCase().includes(query)),
    );
    list.replaceChildren(...shown.map((option) => optionRow(dimension, option)));
    if (shown.length === 0) {
      list.append(el('p', 'filter-empty', query ? 'No publishers match.' : 'No values.'));
    }

    if (focusedKey) {
      const again = [...list.querySelectorAll<HTMLElement>('[data-filter-key]')].find((n) => n.dataset['filterKey'] === focusedKey);
      // A value filtered out of view leaves focus with the group's search box, not <body>.
      (again ?? (dimension === 'publishers' ? publisherSearch : toggle)).focus();
    }
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

  function renderChips(): void {
    chipRow.replaceChildren();
    chipRow.hidden = chips.length === 0;
    if (chips.length === 0) return;
    for (const chip of chips) {
      const button = el('button', 'chip filter-chip', chip.text) as HTMLButtonElement;
      button.setAttribute('aria-label', chip.removeLabel);
      button.dataset['filterKey'] = optionKey(chip.dimension, chip.value);
      const mark = el('span', 'filter-chip-remove', '✕');
      mark.setAttribute('aria-hidden', 'true');
      button.append(mark);
      button.addEventListener('click', () => removeChip(chip));
      chipRow.append(button);
    }
    const clear = el('button', 'chip filter-clear', 'Clear all filters');
    clear.addEventListener('click', () => {
      change({ categories: [], publishers: [], sources: [] });
      toggle.focus();
    });
    chipRow.append(clear);
  }

  /** Removes a chip's filter, then moves focus to the chip after it, the one before it, or the
   * Filters button, so it never drops to <body>. */
  function removeChip(chip: FilterChip): void {
    const removed = optionKey(chip.dimension, chip.value);
    const before = chips.map((c) => optionKey(c.dimension, c.value));
    select(chip.dimension, chip.value, false);
    const after = new Set(chips.map((c) => optionKey(c.dimension, c.value)));
    const next = nearestSurvivor(before, before.indexOf(removed), (key) => after.has(key));
    const target = next === undefined ? undefined : [...chipRow.querySelectorAll<HTMLElement>('[data-filter-key]')].find((b) => b.dataset['filterKey'] === next);
    (target ?? toggle).focus();
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
