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

const UNKNOWN_LABEL = 'Unknown';

/**
 * Splits `rows`, which arrive filtered and sorted, into groups. Each row lands in exactly one group
 * and keeps its order within it. Name groups run A to Z, then "#". Publisher groups are labelled as
 * the filter options label them, sorted by that label, with Unknown last.
 */
export function groupRows(rows: readonly RowVm[], groupBy: MatrixGroupBy, publishers: readonly FacetOption[]): RowGroup[] {
  switch (groupBy) {
    case 'none':
      return [{ key: '', rows: [...rows] }];
    case 'name':
      return collect(rows, nameGroupOf, (key) => key).sort((a, b) => nameRank(a.key) - nameRank(b.key));
    case 'publisher': {
      const options = new Map(publishers.map((option) => [option.value, option]));
      const plainLabel = (key: string) => options.get(key)?.label ?? (key === UNKNOWN_VALUE ? UNKNOWN_LABEL : key);
      const label = (key: string) => {
        const option = options.get(key);
        return option ? optionName(option) : plainLabel(key);
      };
      // Sorted as the publisher filter options are: by label, then by ID for a shared label.
      return collect(rows, (row) => row.publisher?.toLowerCase() ?? UNKNOWN_VALUE, label).sort(
        (a, b) =>
          Number(a.key === UNKNOWN_VALUE) - Number(b.key === UNKNOWN_VALUE) ||
          plainLabel(a.key).toLowerCase().localeCompare(plainLabel(b.key).toLowerCase()) ||
          a.key.localeCompare(b.key),
      );
    }
  }
}

/**
 * A name's group: the letter it starts with, with diacritics folded away so an accented Latin
 * letter files under its base letter. Anything else (digits, symbols, other scripts, and letters
 * such as Æ that do not decompose) files under "#".
 */
function nameGroupOf(row: RowVm): string {
  const first = [...row.displayName.trim()][0] ?? '';
  const folded = first.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().charAt(0);
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
