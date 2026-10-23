import * as vscode from 'vscode';
import { withoutAgentsWindowProfile } from '../core/inventoryQueries';
import type { Inventory } from '../core/types';

/** The inventory the matrix and Home display: without the Agents window profile when the
 * `personas.showAgentsWindowProfile` setting is off. Actions still validate against the full
 * inventory. */
export function shownInventory(inventory: Inventory): Inventory {
  const show = vscode.workspace.getConfiguration('personas').get<boolean>('showAgentsWindowProfile', true);
  return show ? inventory : withoutAgentsWindowProfile(inventory);
}
