// Shared fixtures and lookups for the jsdom tests that render the Extension Matrix table.
import type { Inventory } from '../../src/core/types';

export const inv: Inventory = {
  profiles: [
    { id: 'default', name: 'Default', isDefault: true, inheritsDefaultExtensions: false },
    { id: 'aaa', name: 'Work', isDefault: false, inheritsDefaultExtensions: false },
    { id: 'bbb', name: 'Shared', isDefault: false, inheritsDefaultExtensions: true },
  ],
  extensions: [
    { id: 'pub.a', displayName: 'Alpha', versions: [], applyToAllProfiles: true, installedIn: ['default', 'aaa', 'bbb'], orphaned: false },
    { id: 'pub.b', displayName: 'Beta', versions: [], applyToAllProfiles: false, installedIn: ['aaa'], orphaned: false },
  ],
  warnings: [],
};

/** The base inventory plus an extension that the Shared profile has only through Default. */
export const withInherited: Inventory = {
  ...inv,
  extensions: [
    ...inv.extensions,
    { id: 'pub.g', displayName: 'Gamma', versions: [], applyToAllProfiles: false, installedIn: ['default', 'bbb'], orphaned: false },
  ],
};

/** The body cell where an extension's row meets a profile's column, found through the table's
 * own header cells the way assistive technology pairs them. */
export function cellAt(table: HTMLTableElement, extension: string, profileLabel: string): HTMLTableCellElement {
  const headers = [...(table.tHead?.rows[0]?.cells ?? [])].map((th) => th.textContent);
  const col = headers.indexOf(profileLabel);
  if (col < 0) throw new Error(`No column headed ${profileLabel}; headers are ${headers.join(', ')}`);
  const row = [...table.tBodies].flatMap((body) => [...body.rows]).find((tr) => tr.cells[0]?.textContent?.includes(extension));
  if (!row) throw new Error(`No row for ${extension}`);
  const cell = row.cells[col];
  if (!cell) throw new Error(`Row ${extension} has no cell in column ${profileLabel}`);
  return cell;
}
