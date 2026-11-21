// Groups the Extension Matrix's rows for the Group by control. Grouping only arranges the rows the
// filters already chose, so it changes neither which rows show nor any count.
import type { MatrixGroupBy } from '../protocol';
import { optionName, UNKNOWN_VALUE, type FacetOption, type RowVm } from './render';

/** One table body's rows. A group without a label renders without a heading row. */
export interface RowGroup {
  key: string;
  label?: string;
  rows: RowVm[];
}

/** The name group for every name that does not start with a Latin letter. */
export const OTHER_NAME_GROUP = '#';

const GROUPINGS: readonly MatrixGroupBy[] = ['none', 'name', 'publisher'];

/** True for a grouping the matrix knows, so a stale or unexpected value can fall back to none. */
export function isMatrixGroupBy(value: unknown): value is MatrixGroupBy {
  return GROUPINGS.includes(value as MatrixGroupBy);
}

const UNKNOWN_LABEL = 'Unknown';

/**
 * Splits `rows`, which arrive filtered and sorted, into groups. Each row lands in exactly one group
 * and keeps its order within it. Name groups run A to Z, then "#". Publisher groups are labelled and
 * ordered as the publisher filter options are, with Unknown last.
 */
export function groupRows(rows: readonly RowVm[], groupBy: MatrixGroupBy, publishers: readonly FacetOption[]): RowGroup[] {
  switch (groupBy) {
    case 'none':
      return [{ key: '', rows: [...rows] }];
    case 'name':
      return collect(rows, nameGroupOf, (key) => key).sort((a, b) => nameRank(a.key) - nameRank(b.key));
    case 'publisher':
      return publisherGroups(rows, publishers);
  }
}

/** Publisher groups follow the filter options' order, so the two can never disagree. A publisher
 * with no option (which the view model never produces) comes after them by ID, before Unknown. */
function publisherGroups(rows: readonly RowVm[], publishers: readonly FacetOption[]): RowGroup[] {
  const options = new Map(publishers.map((option, index) => [option.value, { option, index }]));
  const label = (key: string) => {
    const found = options.get(key)?.option;
    if (found) return optionName(found);
    return key === UNKNOWN_VALUE ? UNKNOWN_LABEL : key;
  };
  const rank = (key: string) => options.get(key)?.index ?? publishers.length + Number(key === UNKNOWN_VALUE);
  return collect(rows, (row) => row.publisher?.toLowerCase() ?? UNKNOWN_VALUE, label).sort(
    (a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key),
  );
}

/** Latin letters that NFD leaves whole, mapped to the letter they file under. */
const UNDECOMPOSED_LATIN: Readonly<Record<string, string>> = Object.freeze({
  Æ: 'A', Đ: 'D', Ð: 'D', Ħ: 'H', Ł: 'L', Ø: 'O', Œ: 'O', ẞ: 'S', Þ: 'T',
});

/**
 * A name's group: the letter it starts with, with diacritics folded away so an accented Latin
 * letter files under its base letter. Digits, symbols, and other scripts file under "#".
 */
function nameGroupOf(row: RowVm): string {
  const first = [...row.displayName.trim()][0] ?? '';
  const upper = first.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().charAt(0);
  const folded = UNDECOMPOSED_LATIN[upper] ?? upper;
  return /^[A-Z]$/.test(folded) ? folded : OTHER_NAME_GROUP;
}

/** "#" sorts after Z. */
function nameRank(key: string): number {
  return key === OTHER_NAME_GROUP ? 26 : key.charCodeAt(0) - 65;
}

/** Collects rows into groups by key, in the order each key first appears. */
function collect(rows: readonly RowVm[], keyOf: (row: RowVm) => string, labelOf: (key: string) => string): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  for (const row of rows) {
    const key = keyOf(row);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { key, label: labelOf(key), rows: [] }));
    group.rows.push(row);
  }
  return [...groups.values()];
}
