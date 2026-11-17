// The Extension Matrix table, built from a view model with no module state, so a jsdom test can
// render it directly. Everything stateful (the hover card, pending markers, posting to the host)
// stays in main.ts and reaches the table through the hooks below.
import type { RowVm, ViewModel } from './render';
import { el } from './ui';

export interface MatrixTableHooks {
  /** The extension's icon, or a letter tile when it has none. */
  icon(extId: string, displayName: string): HTMLElement;
  /** True while a change to this cell is in flight. */
  isPending(extId: string, profileId: string): boolean;
  /** Attaches the hover card's listeners to an extension's name. */
  wireName(trigger: HTMLElement, row: RowVm): void;
  toggleCell(extId: string, profileId: string, install: boolean): void;
  showApplyToAllProfilesGuide(extId: string): void;
  showWorkspaceEnablementGuide(extId: string): void;
}

export function renderMatrixTable(vm: ViewModel, hooks: MatrixTableHooks): HTMLTableElement {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  head.append(columnHeader('ext-col', 'Extension'));
  for (const p of vm.profileNames) {
    const th = columnHeader('', p.label);
    if (p.tooltip) th.title = p.tooltip;
    head.append(th);
  }
  if (vm.workspace) {
    const workspaceHead = columnHeader('workspace-col workspace-header');
    workspaceHead.append(
      el('span', 'workspace-header-title', 'Current workspace'),
      el('span', 'workspace-header-name', vm.workspace.name),
    );
    head.append(workspaceHead);
  }

  const body = table.createTBody();
  for (const row of vm.rows) {
    const tr = body.insertRow();
    tr.append(nameCell(row, hooks));
    row.cells.forEach((cell, index) => {
      const where = `${row.displayName} in ${vm.profileNames[index]?.name ?? cell.profileId}`;
      const isPending = hooks.isPending(row.id, cell.profileId);
      const td = el('td', isPending ? 'cell pending' : 'cell');
      if (cell.workspaceOnly) {
        td.append(el('span', 'muted', '—'));
        td.title = 'Workspace-only extension — profile installation actions are unavailable.';
        td.setAttribute('aria-label', 'Not represented in this profile; read-only workspace extension');
      } else if (isPending) {
        td.append(el('span', 'spinner', '◐'));
      } else if (cell.disabled) {
        td.append(el('span', 'muted', cell.installed ? '✓' : '—'));
        td.title = 'This profile\'s extension list could not be read — actions are disabled.';
      } else if (cell.profileInheritsDefault) {
        td.append(el('span', 'muted', cell.installed ? '✓' : ''));
        td.title = 'This profile inherits the default profile\'s extensions.';
      } else if (row.applyToAllProfiles) {
        td.append(el('span', 'muted', '✓'));
        td.title = 'Applied to all profiles — use the badge next to the name to change.';
      } else {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = cell.installed;
        box.setAttribute('aria-label', where);
        box.addEventListener('change', () => hooks.toggleCell(row.id, cell.profileId, box.checked));
        td.append(box);
      }
      tr.append(td);
    });
    if (vm.workspace) tr.append(workspaceCell(row, hooks));
  }

  // Indexes for the crosshair highlight: every row has one cell per column (no spans), so a
  // cell's position is its column. Body rows count from 0, after the header row.
  [...table.rows].forEach((tr, i) => {
    if (i > 0) tr.dataset['row'] = String(i - 1);
    [...tr.cells].forEach((cellEl, col) => (cellEl.dataset['col'] = String(col)));
  });
  return table;
}

function columnHeader(className: string, text?: string): HTMLElement {
  const th = el('th', className, text);
  th.setAttribute('scope', 'col');
  return th;
}

/** The extension's name heads its row, so a screen reader announces it with every cell. */
function nameCell(row: RowVm, hooks: MatrixTableHooks): HTMLElement {
  const name = el('th', 'ext-col');
  name.setAttribute('scope', 'row');
  name.append(hooks.icon(row.id, row.displayName));
  // The name itself is the hover-card trigger: hover (after a short delay) or keyboard focus
  // (immediate) opens the card with detail + the row's bulk actions.
  const nameTrigger = el('span', row.orphaned ? 'name orphaned' : 'name', row.displayName);
  nameTrigger.dataset['extId'] = row.id; // lets syncOpenCard re-anchor after a rebuild
  nameTrigger.tabIndex = 0;
  nameTrigger.setAttribute('role', 'button');
  nameTrigger.setAttribute('aria-haspopup', 'true');
  hooks.wireName(nameTrigger, row);
  name.append(nameTrigger);

  if (row.applyToAllProfiles) {
    const badge = el('button', 'badge', 'ALL');
    badge.title = 'Applied to all profiles — click for how to change';
    badge.addEventListener('click', () => hooks.showApplyToAllProfilesGuide(row.id));
    name.append(badge);
  }
  return name;
}

function workspaceCell(row: RowVm, hooks: MatrixTableHooks): HTMLElement {
  const status = row.workspaceCell;
  const td = el('td', `workspace-col workspace-state workspace-${status?.state ?? 'unknown'}`);
  const label = status?.label ?? 'Unknown';
  const symbol = status?.symbol ?? '?';
  td.title = status?.tooltip ?? 'Unknown — no supported workspace status evidence was available.';
  // Guided hand-off (ADR-0003): no CLI persists workspace enablement, so the cell becomes a
  // button that opens the extension in VS Code's Extensions view instead of changing it.
  const guide = status?.offersEnablementGuide ? el('button', 'workspace-guide') : undefined;
  if (guide) {
    td.title += ' Opens the Extensions view to enable or disable it for this workspace.';
    td.classList.add('workspace-guide-cell'); // the button, not the cell, carries the padding
    guide.addEventListener('click', () => hooks.showWorkspaceEnablementGuide(row.id));
    td.append(guide);
  }
  const labelled = guide ?? td;
  labelled.append(el('span', 'workspace-symbol', symbol), el('span', 'sr-only', label));
  labelled.setAttribute('aria-label', `${label}. ${td.title}`);
  return td;
}
