// Read-only questions about a composed Inventory, shared by the host and the webviews. The
// webview bundles import this module, so it must not import anything that needs Node.
import type { Inventory } from './types';

/** Profiles a warning disabled: unreadable data, or a name the code CLI cannot tell apart. */
export function disabledProfileIds(inventory: Inventory): Set<string> {
  return new Set(inventory.warnings.flatMap((w) => w.affectedProfileIds));
}

export function orphanCount(inventory: Inventory): number {
  return inventory.extensions.filter((e) => e.orphaned).length;
}
