// Shared fixtures and lookups for the jsdom tests that render the Extension Matrix table.
import type { Inventory } from '../../src/core/types';
import type { HostToMatrix, MatrixToHost } from '../../src/protocol';

/** Delivers a host message to the webview, as the extension host would. */
export function sendToMatrix(message: HostToMatrix): void {
  window.dispatchEvent(new MessageEvent('message', { data: message, origin: window.location.origin }));
}

/** Loads the real Extension Matrix webview (main.ts) once per test file, collecting what it posts. */
export async function loadMatrixWebview(posted: MatrixToHost[]): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  const g = globalThis as unknown as Record<string, unknown>;
  g['acquireVsCodeApi'] = () => ({ postMessage: (m: MatrixToHost) => posted.push(m) });
  if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    // jsdom has no CSS.escape; main.ts uses it only for extension IDs, which need no escaping here.
    g['CSS'] = { escape: (value: string) => value };
  }
  await import('../../src/webview/main.js'); // Vite resolves the .js specifier to main.ts
}

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

/** The Extension Matrix table the loaded webview shows. */
export const shownTable = () => document.querySelector<HTMLTableElement>('.content table')!;

/** The checkbox where an extension's row meets a profile's column in the shown table. */
export function checkbox(extension: string, profile: string): HTMLInputElement {
  return cellAt(shownTable(), extension, profile).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

/** An extension's name, the button that opens its hover card, in the shown table. */
export function nameOf(extension: string): HTMLElement {
  return cellAt(shownTable(), extension, 'Extension').querySelector<HTMLElement>('.name')!;
}

/** The base inventory with filter data: Alpha is Contoso's (Linters and Themes, from the
 * Marketplace), Beta is Fabrikam's (Linters, from the Marketplace and a VSIX), and Gamma has no
 * publisher, categories, or install source. */
export const faceted: Inventory = {
  ...withInherited,
  extensions: withInherited.extensions.map((e) => {
    if (e.id === 'pub.a') {
      return { ...e, publisher: 'contoso', publisherDisplayName: 'Contoso Ltd', categories: ['Linters', 'Themes'], installSources: ['gallery'] };
    }
    if (e.id === 'pub.b') return { ...e, publisher: 'fabrikam', categories: ['Linters'], installSources: ['gallery', 'vsix'] };
    return { ...e, installSourceMissing: true };
  }),
};
