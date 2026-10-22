// Read-only questions about a composed Inventory, shared by the host and the webviews. The
// webview bundles import this module, so it must not import anything that needs Node.
import type { Inventory, WorkspaceExtensionStatus } from './types';

/** Profiles a warning disabled: unreadable data, or a name the code CLI cannot tell apart. */
export function disabledProfileIds(inventory: Inventory): Set<string> {
  return new Set(inventory.warnings.flatMap((w) => w.affectedProfileIds));
}

export function orphanCount(inventory: Inventory): number {
  return inventory.extensions.filter((e) => e.orphaned).length;
}

/** Whether the workspace column offers the hand-off to VS Code's own "Enable (Workspace)" /
 * "Disable (Workspace)" actions (ADR-0003): for Enabled (which includes Workspace-local) and
 * Not enabled; never for Not installed in profile or Unknown. */
export function offersWorkspaceEnablementGuide(status: WorkspaceExtensionStatus): boolean {
  return status.state === 'enabled' || status.state === 'notEnabled';
}
