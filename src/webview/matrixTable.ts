// The Extension Matrix table is built from a view model with no module state, so a jsdom test can
// render it directly. Everything stateful (the hover card, pending markers, and posting to the
// host) stays in main.ts and reaches the table through the hooks below.
import type { CellVm, InstallState, ReadOnlyReason, RowVm, ViewModel } from './render';
import { focusKey } from './matrixFocus';
import type { RowGroup } from './matrixGroups';
import { el, extensionCount } from './ui';

export interface MatrixTableHooks {
  /** Returns the extension's icon, or a letter tile when it has none. */
  icon(extId: string, displayName: string): HTMLElement;
  /** Reports whether a change to this cell is in flight. */
  isPending(extId: string, profileId: string): boolean;
  /** Attaches the hover card's listeners to an extension's name. */
  attachHoverCard(trigger: HTMLElement, row: RowVm): void;
  /** Requests an install or uninstall after the user toggles a checkbox. */
  toggleCell(extId: string, profileId: string, install: boolean): void;
  showApplyToAllProfilesGuide(extId: string): void;
  showWorkspaceEnablementGuide(extId: string): void;
}

/** Renders the matrix with one table body per group (by default, one body holding every row). */
export function renderMatrixTable(
  vm: ViewModel,
  hooks: MatrixTableHooks,
  groups: readonly RowGroup[] = [{ key: '', rows: vm.rows }],
): HTMLTableElement {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  fillHeaderRow(head, vm);

  const columnCount = head.cells.length;
  let rowIndex = 0;
  for (const group of groups) {
    const body = table.createTBody();
    if (group.label !== undefined) body.append(groupHeading(group, columnCount));
    for (const row of group.rows) body.append(dataRow(vm, hooks, row, rowIndex++));
  }

  // Indexes for the crosshair highlight: every data row has one cell per column (no spans), so a
  // cell's position is its column. Data rows count from 0 in the order shown; the head row and
  // group heading rows get no index, so the crosshair never lands on them.
  const dataRows = [...table.tBodies].flatMap((body) => [...body.rows]).filter((tr) => !tr.classList.contains('group-heading'));
  dataRows.forEach((tr, i) => (tr.dataset['row'] = String(i)));
  for (const tr of [head, ...dataRows]) [...tr.cells].forEach((cellEl, col) => (cellEl.dataset['col'] = String(col)));
  return table;
}

/** The column headers: Extension, one per profile, and the current workspace when one is open. */
function fillHeaderRow(head: HTMLTableRowElement, vm: ViewModel): void {
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
}

/** One extension's row: its name, a cell per profile, and its workspace status. */
function dataRow(vm: ViewModel, hooks: MatrixTableHooks, row: RowVm, rowIndex: number): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.append(nameCell(row, hooks));
  row.cells.forEach((cell, index) => {
    // The cell's accessible name pairs the extension with the profile, as in "PowerShell in Work".
    const cellName = `${row.displayName} in ${vm.profileNames[index]?.name ?? cell.profileId}`;
    tr.append(profileCell(hooks, row, cell, cellName, `pending-status-${rowIndex}-${index}`));
  });
  if (vm.workspace) tr.append(workspaceCell(row, hooks));
  return tr;
}

function profileCell(hooks: MatrixTableHooks, row: RowVm, cell: CellVm, cellName: string, statusId: string): HTMLElement {
  const isPending = hooks.isPending(row.id, cell.profileId);
  const td = el('td', isPending ? 'cell pending' : 'cell');
  // A pending writable cell stays a checkbox (below); a pending read-only cell has no control.
  if (isPending && cell.readOnlyReason && cell.readOnlyReason !== 'workspaceOnly') {
    labelCell(td, glyph('spinner', '◐'), `${cellName}: change in progress`);
  } else if (cell.readOnlyReason) {
    const shown = describeReadOnlyCell(cell.install, cell.readOnlyReason);
    labelCell(td, glyph(`glyph ${shown.className}`, shown.glyph), `${cellName}: ${shown.state}`);
    td.title = shown.title;
  } else {
    appendCheckbox(td, hooks, row, cell, cellName, isPending ? statusId : undefined);
  }
  return td;
}

/** A writable cell's checkbox. `pendingStatusId` is set while a change to the cell is in flight. */
function appendCheckbox(
  td: HTMLElement,
  hooks: MatrixTableHooks,
  row: RowVm,
  cell: CellVm,
  cellName: string,
  pendingStatusId: string | undefined,
): void {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = cell.install === 'installed';
  box.setAttribute('aria-label', cellName);
  box.dataset['focusKey'] = focusKey({ extId: row.id, slot: `profile:${cell.profileId}` });
  td.append(box);
  if (pendingStatusId === undefined) {
    box.addEventListener('change', () => hooks.toggleCell(row.id, cell.profileId, box.checked));
    return;
  }
  // A pending cell stays a checkbox so it keeps focus and its name while the change is in
  // flight. aria-disabled, unlike disabled, leaves it focusable. It shows the current
  // install (not optimistic UI) until the host's next inventory confirms the change.
  const status = el('span', 'sr-only', 'change in progress');
  status.id = pendingStatusId;
  box.setAttribute('aria-disabled', 'true');
  box.setAttribute('aria-describedby', status.id);
  box.addEventListener('click', (e) => e.preventDefault());
  td.append(glyph('spinner', '◐'), status);
}

/** A group's heading row: one row-group header spanning every column, holding the group's name
 * and count and no controls. NVDA announced this markup as the group heading (#129). */
function groupHeading(group: RowGroup, columnCount: number): HTMLTableRowElement {
  const tr = el('tr', 'group-heading') as HTMLTableRowElement;
  const th = el('th', 'group-heading-cell') as HTMLTableCellElement;
  th.setAttribute('scope', 'rowgroup');
  th.colSpan = columnCount;
  const label = el('span', 'group-label', group.label);
  label.append(el('span', 'group-count', `, ${extensionCount(group.rows.length)}`));
  th.append(label);
  tr.append(th);
  return tr;
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
  const nameTrigger = el('span', row.orphaned ? 'name orphaned' : 'name', row.displayName);
  nameTrigger.dataset['extId'] = row.id; // syncOpenCard uses this to re-anchor the card after a rebuild.
  nameTrigger.tabIndex = 0;
  nameTrigger.setAttribute('role', 'button');
  nameTrigger.setAttribute('aria-haspopup', 'true');
  nameTrigger.dataset['focusKey'] = focusKey({ extId: row.id, slot: 'name' });
  hooks.attachHoverCard(nameTrigger, row);
  name.append(nameTrigger);

  if (row.applyToAllProfiles) {
    const badge = el('button', 'badge', 'ALL');
    badge.title = 'Applied to all profiles — click for how to change';
    badge.dataset['focusKey'] = focusKey({ extId: row.id, slot: 'all' });
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
    td.classList.add('workspace-guide-cell'); // The button, not the cell, carries the padding.
    guide.dataset['focusKey'] = focusKey({ extId: row.id, slot: 'workspace' });
    guide.addEventListener('click', () => hooks.showWorkspaceEnablementGuide(row.id));
    td.append(guide);
  }
  const labelled = guide ?? td;
  labelled.append(el('span', 'workspace-symbol', symbol), el('span', 'sr-only', label));
  labelled.setAttribute('aria-label', `${label}. ${td.title}`);
  return td;
}

/** Labels a cell that has no checkbox. The label is also written as screen-reader text, as the
 * workspace column does, because some screen readers ignore `aria-label` on a plain table cell. */
function labelCell(td: HTMLElement, mark: HTMLElement, label: string): void {
  td.append(mark, el('span', 'sr-only', label));
  td.setAttribute('aria-label', label);
}

/** Creates a cell's visible mark. The cell's label carries its meaning, so assistive technology
 * skips the mark. */
function glyph(className: string, text: string): HTMLElement {
  const mark = el('span', className, text);
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

/** These are the glyphs for read-only cells. Each one differs by shape, not only by color, and
 * the legend explains them. */
const GLYPHS = {
  appliedToAllProfiles: { glyph: '◆', className: 'glyph-applied', legend: 'Applied to all profiles' },
  inherited: { glyph: '⤷', className: 'glyph-inherited', legend: 'Installed through Default' },
  installed: { glyph: '✓', className: 'glyph-installed', legend: "Installed, can't change here" },
  notInstalled: { glyph: '—', className: 'glyph-absent', legend: 'Not installed' },
  unknown: { glyph: '?', className: 'glyph-unknown', legend: 'Unknown, list could not be read' },
} as const;

interface ReadOnlyCellView {
  glyph: string;
  className: string;
  /** The state is read after "<extension> in <profile>: ". */
  state: string;
  /** The tooltip gives the reason that the cell cannot act. */
  title: string;
}

const USES_DEFAULT = "This profile uses the Default profile's extensions.";

function describeReadOnlyCell(install: InstallState, reason: ReadOnlyReason): ReadOnlyCellView {
  const show = (kind: keyof typeof GLYPHS, state: string, title: string): ReadOnlyCellView => ({
    glyph: GLYPHS[kind].glyph,
    className: GLYPHS[kind].className,
    state,
    title,
  });
  // A profile whose list was read but which the code CLI cannot target shows its known install.
  const locked = (why: string, title: string): ReadOnlyCellView =>
    install === 'installed'
      ? show('installed', `installed, can't change because ${why}`, title)
      : show('notInstalled', `not installed, can't change because ${why}`, title);
  switch (reason) {
    case 'appliedToAllProfiles':
      return show(
        'appliedToAllProfiles',
        'applied to all profiles',
        'Applied to all profiles — use the badge next to the name to change.',
      );
    case 'inheritsDefault':
      if (install === 'unknown') {
        return show(
          'unknown',
          "unknown, Default's extension list could not be read",
          `${USES_DEFAULT} The Default profile's extension list could not be read, so this is unknown.`,
        );
      }
      return install === 'installed'
        ? show('inherited', 'installed through Default', USES_DEFAULT)
        : show('notInstalled', "not installed, uses Default's extensions", USES_DEFAULT);
    case 'unreadable':
      return show(
        'unknown',
        'unknown, the extension list could not be read',
        "This profile's extension list could not be read, so what is installed is unknown and actions are disabled.",
      );
    case 'profileRegistry':
      return locked(
        'the profile list could not be read',
        "VS Code's list of profiles could not be read, so Personas cannot be sure which profile a change " +
          'would reach, and changes are disabled.',
      );
    case 'duplicateName':
      return locked(
        'the profile name is ambiguous',
        'The code CLI picks a profile by name, and it cannot target this one by name because another profile ' +
          'shares it or it is named "Default". Rename the profile in VS Code to change it here.',
      );
    case 'workspaceOnly':
      return show(
        'notInstalled',
        'not in this profile, read-only workspace extension',
        'Workspace-only extension — profile installation actions are unavailable.',
      );
  }
}

/** Renders a short key to the read-only cell glyphs. */
export function renderMatrixLegend(): HTMLElement {
  const legend = el('ul', 'matrix-legend');
  legend.setAttribute('aria-label', 'Extension Matrix cell legend');
  for (const entry of Object.values(GLYPHS)) {
    const item = el('li', '');
    item.append(glyph(`glyph ${entry.className}`, entry.glyph), ` ${entry.legend}`);
    legend.append(item);
  }
  return legend;
}
