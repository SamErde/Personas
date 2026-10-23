import type { Inventory, OrphanInfo, WorkspaceInventory } from '../core/types';
import type { HostToMatrix, MatrixToHost } from '../protocol';
import { orphanCount } from '../core/inventoryQueries';
import { buildViewModel, type Chip, type RowVm } from './render';
import { crosshairFor, type GridHit } from './crosshair';
import { el, formatBytes } from './ui';
import { isTrustedHostMessageOrigin, safeImageSource } from './messageSecurity';

declare function acquireVsCodeApi(): { postMessage(m: MatrixToHost): void };
const vscode = acquireVsCodeApi();

let inventory: Inventory | undefined;
let workspace: WorkspaceInventory | undefined;
let renderedRows: RowVm[] = [];
let icons: Record<string, string> = {}; // extId -> webview URI, from the host's inventory push
let chip: Chip = 'all';
let filter = '';
let pending = new Set<string>(); // `${extId}|${profileId}`, echoed back by the host
// Presentation-only "in flight" state set the instant the user acts, before the host's 'pending'
// round-trip lands — never shows a target state early (not optimistic UI), only a working state.
// Keys are `${extId}|${profileId}` for a single-cell toggle, or `${extId}|*` for a card bulk
// action (Install in every profile / Remove from every profile) whose per-cell targets are
// computed host-side and only become known once the user confirms the resulting modal. Cleared
// wholesale whenever a fresh 'inventory' message arrives (mirrors the `pending` reset below);
// the `${extId}|*` keys are additionally cleared on 'orphans'/'cleanupResult' since those don't
// imply an inventory refresh on their own. This also covers the modal-cancel path for free:
// cancelling triggers a host-side refresh, which pushes a fresh 'inventory', which clears
// localPending, which reverts the cell/button to its normal look — no timers needed.
let localPending = new Set<string>();
let orphans: OrphanInfo[] | undefined; // non-undefined = cleanup view open
let checked = new Set<string>(); // folderNames selected for cleanup
let banner = '';

const app = document.getElementById('app') as HTMLDivElement;

// --- Persistent skeleton, built exactly once -----------------------------------------------
// The filter <input> must never be removed or recreated after startup: rebuilding the toolbar
// on every render (the previous design) stole keyboard focus/caret on every keystroke, and
// again on every host push ('pending', 'inventory', ...) that landed mid-typing. Everything
// that changes over time — the matrix table, the cleanup checklist, warning banners — lives
// inside `contentEl`, which is freely torn down and rebuilt. Toolbar controls instead update
// in place: chip classes are toggled, the orphan-review button's label/visibility is updated,
// and the filter input is left completely alone by every code path except its own listener.
app.replaceChildren();

const toolbar = el('div', 'toolbar');

const filterInput = document.createElement('input');
filterInput.type = 'search';
filterInput.placeholder = 'Filter extensions…';
filterInput.addEventListener('input', () => {
  filter = filterInput.value;
  renderContent();
});
toolbar.append(filterInput);

const chipButtons: [Chip, HTMLElement][] = [];
for (const [key, label] of [['all', 'All'], ['orphaned', 'Orphaned'], ['appliedToAllProfiles', 'Applied to all profiles']] as const) {
  const b = el('button', chip === key ? 'chip active' : 'chip', label);
  b.addEventListener('click', () => {
    chip = key;
    updateChipButtons();
    renderContent();
  });
  chipButtons.push([key, b]);
  toolbar.append(b);
}

const orphanButton = el('button', 'chip cleanup', '');
orphanButton.hidden = true;
orphanButton.addEventListener('click', () => post({ type: 'requestOrphans' }));
toolbar.append(orphanButton);

const refreshButton = el('button', 'chip refresh', '↻ Refresh');
refreshButton.title = 'Refresh from disk';
refreshButton.addEventListener('click', () => post({ type: 'refresh' }));
toolbar.append(refreshButton);

const contentEl = el('div', 'content');
app.append(toolbar, contentEl);
// ---------------------------------------------------------------------------------------------

// --- Extension detail hover card ------------------------------------------------------------
// A single reusable element (not rebuilt per row) shown on hover (after a short delay) or
// immediately on keyboard focus of an extension's name. It carries the per-row bulk actions that
// used to live inline in the row, plus read-only detail (publisher, description, install
// metadata) sourced directly from the live `inventory` — the card is presentation only; the
// business rules (which targets a bulk action affects, when it's disabled) stay host-side.
const card = el('div', 'ext-card');
card.hidden = true;
card.setAttribute('role', 'group');
// Programmatic-focus fallback target for syncOpenCard's focus restoration (not in tab order).
card.tabIndex = -1;
document.body.append(card);

let cardOwnerExtId: string | undefined;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function clearShowTimer(): void {
  if (showTimer !== undefined) {
    clearTimeout(showTimer);
    showTimer = undefined;
  }
}

function cancelHide(): void {
  if (hideTimer !== undefined) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

/** Short delay so moving the pointer from the name to the card (they're adjacent, no dead gap)
 * doesn't flicker-close it — cancelled by mouseenter on either element. */
function scheduleHideCard(): void {
  cancelHide();
  hideTimer = setTimeout(hideCard, 100);
}

function scheduleShowCard(extId: string, trigger: HTMLElement, delayMs: number): void {
  clearShowTimer();
  cancelHide();
  if (delayMs <= 0) {
    showCard(extId, trigger);
    return;
  }
  showTimer = setTimeout(() => showCard(extId, trigger), delayMs);
}

function hideCard(): void {
  clearShowTimer();
  cancelHide();
  if (card.hidden) return;
  card.hidden = true;
  card.replaceChildren();
  cardOwnerExtId = undefined;
  applyCrosshair(); // the card's row no longer holds the highlight
}

function showCard(extId: string, trigger: HTMLElement): void {
  clearShowTimer();
  cancelHide();
  if (!inventory) return;
  // A pending show timer can outlive a content rebuild — its captured trigger element is then
  // detached and would position the card at (0,0). Ignore it; the re-created element gets its
  // own listeners.
  if (!trigger.isConnected) return;
  const row = renderedRows.find((item) => item.id === extId);
  if (!row) return;
  cardOwnerExtId = extId;
  rebuildCard(row);
  card.hidden = false;
  positionCard(trigger);
  applyCrosshair();
}

/** True while buildCardContent is replacing the card's children — the removal of a focused
 * child fires a focusout with no in-card relatedTarget, which must not be mistaken for the
 * user tabbing away (it would close the card on every live refresh for keyboard users). */
let rebuildingCard = false;

function rebuildCard(row: RowVm): void {
  rebuildingCard = true;
  try {
    buildCardContent(row);
  } finally {
    rebuildingCard = false;
  }
}

/**
 * Called after every content rebuild: an open card's anchor element was just discarded with the
 * old table. Rather than closing the card on each unrelated refresh (watcher-driven inventory
 * pushes land often, and 'pending' pushes must update the card's disabled buttons live),
 * re-anchor it to the extension's re-created name element and rebuild its contents from the new
 * inventory. Hidden only when the extension no longer exists or its row is no longer rendered
 * (e.g. filtered out).
 */
function syncOpenCard(): void {
  if (card.hidden || cardOwnerExtId === undefined) return;
  const row = renderedRows.find((item) => item.id === cardOwnerExtId);
  const trigger = contentEl.querySelector<HTMLElement>(`.name[data-ext-id="${CSS.escape(cardOwnerExtId)}"]`);
  if (!row || !trigger) {
    hideCard();
    return;
  }

  // If keyboard focus was inside the card, the rebuild is about to drop it to <body>, which
  // would leave an open card that no longer closes on tab-away. Remember which control held
  // focus (by its stable data-action name) and restore it after the rebuild — falling back to
  // the card container itself (tabindex=-1) when the control no longer exists (e.g. the
  // extension became applied to all profiles and install/remove disappeared). Escape still closes either way.
  const active = document.activeElement;
  const focusedAction =
    active instanceof HTMLElement && card.contains(active) ? active.dataset['action'] : undefined;
  const focusWasInCard = active instanceof HTMLElement && card.contains(active);

  rebuildCard(row);
  positionCard(trigger);

  if (focusWasInCard) {
    rebuildingCard = true; // the focus() below must not look like a tab-away to card focusout
    try {
      const restored = focusedAction
        ? card.querySelector<HTMLElement>(`[data-action="${CSS.escape(focusedAction)}"]`)
        : undefined;
      // focus() on a disabled button is a silent no-op (focus would drop to <body>) — a button
      // that just became pending-disabled falls back to the card container instead.
      const focusable = restored && !(restored as HTMLButtonElement).disabled ? restored : card;
      focusable.focus();
    } finally {
      rebuildingCard = false;
    }
  }
}

function buildCardContent(ext: RowVm): void {
  card.replaceChildren();

  const header = el('div', 'ext-card-header');
  header.append(extIcon(ext.id, ext.displayName));
  if (ext.profileBacked) {
    const nameLink = el('a', 'ext-card-name', ext.displayName) as HTMLAnchorElement;
    nameLink.href = '#';
    nameLink.tabIndex = 0;
    nameLink.dataset['action'] = 'open-page'; // stable id for syncOpenCard's focus restoration
    const openPage = (e: Event) => {
      e.preventDefault();
      post({ type: 'openExtensionPage', extId: ext.id });
    };
    nameLink.addEventListener('click', openPage);
    nameLink.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') openPage(e);
    });
    header.append(nameLink);
  } else {
    header.append(el('span', 'ext-card-name', ext.displayName));
  }
  card.append(header);

  const publisherText = ext.publisherDisplayName ?? ext.publisher;
  if (publisherText) card.append(el('div', 'ext-card-publisher', publisherText));

  if (ext.description) card.append(el('div', 'ext-card-description', ext.description));

  if (ext.version || ext.sourceLabel) {
    const metaParts = ext.version ? [`v${ext.version}`] : [];
    // "installed" is the local install time from offline metadata, not a marketplace publish date.
    if (ext.installedTimestampMs !== undefined) {
      metaParts.push(`installed ${new Date(ext.installedTimestampMs).toLocaleDateString()}`);
    }
    if (ext.sourceLabel) metaParts.push(ext.sourceLabel);
    card.append(el('div', 'ext-card-meta', metaParts.join(' · ')));
  }

  if (!ext.profileBacked) {
    card.append(el('div', 'ext-card-meta', 'Read-only workspace extension; profile actions are unavailable.'));
    return;
  }

  // Host-echoed per-cell pending plus this extension's local (not-yet-echoed) keys — the same
  // `${ext.id}|` prefix check covers both a single toggled cell and the `${ext.id}|*` bulk key.
  const bulkKey = `${ext.id}|*`;
  const rowPending = [...pending, ...localPending].some((key) => key.startsWith(`${ext.id}|`));
  const bulkInFlight = localPending.has(bulkKey);
  const actions = el('div', 'ext-card-actions');
  if (!ext.applyToAllProfiles) {
    const installAllBtn = el('button', 'row-action', 'Install in every profile') as HTMLButtonElement;
    installAllBtn.dataset['action'] = 'install-in-every-profile';
    installAllBtn.title =
      "Installs separately into each profile via the VS Code CLI. Unlike an extension applied to all profiles, profiles created later will not get it.";
    installAllBtn.disabled = rowPending;
    installAllBtn.classList.toggle('in-flight', bulkInFlight);
    installAllBtn.addEventListener('click', () => {
      // Immediate local feedback: the modal that decides real targets hasn't run yet, so only
      // the clicked control itself gets an in-flight look — cells wait for the host's echoes.
      localPending.add(bulkKey);
      renderContent();
      post({ type: 'installInEveryProfile', extId: ext.id });
    });
    actions.append(installAllBtn);

    const removeAllBtn = el('button', 'row-action', 'Remove from every profile') as HTMLButtonElement;
    removeAllBtn.dataset['action'] = 'remove-from-every-profile';
    removeAllBtn.title = 'Uninstall from every profile where it is directly installed.';
    removeAllBtn.disabled = rowPending;
    removeAllBtn.classList.toggle('in-flight', bulkInFlight);
    removeAllBtn.addEventListener('click', () => {
      localPending.add(bulkKey);
      renderContent();
      post({ type: 'removeFromEveryProfile', extId: ext.id });
    });
    actions.append(removeAllBtn);
  }
  const applyAllBtn = el('button', 'row-action', 'Apply to all profiles…') as HTMLButtonElement;
  applyAllBtn.dataset['action'] = 'apply-all';
  applyAllBtn.title =
    "Opens the Extensions view where you can toggle VS Code's native 'Apply Extension to all Profiles' option — VS Code provides no API for extensions to toggle it directly.";
  applyAllBtn.disabled = rowPending;
  applyAllBtn.addEventListener('click', () => post({ type: 'showApplyToAllProfilesGuide', extId: ext.id }));
  actions.append(applyAllBtn);
  card.append(actions);
}

/** Positions the card near `trigger`, flipping above/left when it would overflow the viewport. */
function positionCard(trigger: HTMLElement): void {
  const margin = 6;
  const rect = trigger.getBoundingClientRect();
  card.style.left = `${margin}px`;
  card.style.top = `${margin}px`;
  const cardRect = card.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.left;
  if (left + cardRect.width > vw - margin) left = rect.right - cardRect.width; // flip left
  left = Math.min(Math.max(margin, left), Math.max(margin, vw - cardRect.width - margin));

  let top = rect.bottom + margin;
  if (top + cardRect.height > vh - margin) top = rect.top - cardRect.height - margin; // flip above
  top = Math.max(margin, top);

  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

card.addEventListener('mouseenter', cancelHide);
card.addEventListener('mouseleave', scheduleHideCard);
// The card must never trap focus: tabbing (or otherwise moving focus) to anything outside it —
// including back to the name that opened it — closes it.
card.addEventListener('focusout', (e) => {
  if (rebuildingCard) return; // focus lost to a live rebuild, not to the user tabbing away
  const related = (e as FocusEvent).relatedTarget;
  if (related instanceof Node && card.contains(related)) return;
  hideCard();
});
document.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Escape' && !card.hidden) hideCard();
});
window.addEventListener(
  'scroll',
  () => {
    if (!card.hidden) hideCard();
  },
  { capture: true },
);
// ---------------------------------------------------------------------------------------------

// --- Crosshair highlight --------------------------------------------------------------------
// Highlights the row and column under the pointer or keyboard focus so the user doesn't lose
// their place in a wide grid. Delegated on the persistent `contentEl` (the table is rebuilt on
// every render) and keyed by the `data-row` / `data-col` indexes renderContent() stamps on the
// table. Nothing about the hit itself is stored: each apply re-reads the element under the last
// pointer position and the live `document.activeElement`, so a rebuild can't leave a stale row
// or column behind (a focused checkbox removed by a rebuild fires its focusout while detached,
// which never reaches `contentEl`).
const CROSSHAIR_CLASSES = ['crosshair', 'crosshair-label', 'crosshair-cell'];
let pointerAt: { x: number; y: number } | undefined; // last position while over contentEl

function gridHitAt(target: EventTarget | null): GridHit | undefined {
  if (!(target instanceof Element)) return undefined;
  const cellEl = target.closest<HTMLElement>('th[data-col], td[data-col]');
  if (!cellEl || !contentEl.contains(cellEl)) return undefined;
  const col = Number(cellEl.dataset['col']);
  if (cellEl.tagName === 'TH') return { kind: 'header', col };
  const row = Number(cellEl.closest<HTMLElement>('tr')?.dataset['row']);
  return col === 0 ? { kind: 'name', row } : { kind: 'cell', row, col };
}

/** Body-row index of the extension whose hover card is open, if that row is rendered. */
function openCardRow(): number | undefined {
  if (card.hidden) return undefined;
  const index = renderedRows.findIndex((r) => r.id === cardOwnerExtId);
  return index >= 0 ? index : undefined;
}

function applyCrosshair(): void {
  for (const node of contentEl.querySelectorAll(CROSSHAIR_CLASSES.map((c) => `.${c}`).join(', '))) {
    node.classList.remove(...CROSSHAIR_CLASSES);
  }
  const { row, col, outlineCell } = crosshairFor({
    pointer: pointerAt && gridHitAt(document.elementFromPoint(pointerAt.x, pointerAt.y)),
    focus: gridHitAt(document.activeElement),
    cardRow: openCardRow(),
  });
  // The row's name cell and the column's header are labels: what the user reads to find their
  // place, so they get the stronger emphasis.
  const rowCells = contentEl.querySelectorAll<HTMLElement>(`tr[data-row="${row}"] > td`);
  if (row !== undefined) {
    for (const node of rowCells) node.classList.add(node.dataset['col'] === '0' ? 'crosshair-label' : 'crosshair');
  }
  if (col !== undefined) {
    for (const node of contentEl.querySelectorAll<HTMLElement>(`[data-col="${col}"]`)) {
      node.classList.add(node.tagName === 'TH' ? 'crosshair-label' : 'crosshair');
    }
  }
  if (outlineCell) rowCells[col ?? -1]?.classList.add('crosshair-cell');
}

contentEl.addEventListener('pointerover', (e) => {
  pointerAt = { x: e.clientX, y: e.clientY };
  applyCrosshair();
});
contentEl.addEventListener('pointerleave', () => {
  pointerAt = undefined;
  applyCrosshair();
});
// During focusout, activeElement is already <body>, so leaving the table clears the focus hit;
// moving within the table re-applies on the focusin that follows.
contentEl.addEventListener('focusin', applyCrosshair);
contentEl.addEventListener('focusout', applyCrosshair);
// ---------------------------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent<HostToMatrix>) => {
  if (!isTrustedHostMessageOrigin(event.origin, window.location.origin)) return;

  const m = event.data;
  switch (m.type) {
    case 'inventory':
      inventory = m.inventory;
      workspace = m.workspace;
      icons = m.icons;
      pending = new Set();
      localPending = new Set();
      if (orphans !== undefined) {
        // The cleanup view's snapshot is now stale (inventory changed under it) — ask the
        // host for a fresh orphan list instead of leaving the old one on screen.
        post({ type: 'requestOrphans' });
      }
      render();
      return;
    case 'pending':
      pending.add(`${m.extId}|${m.profileId}`);
      render();
      return;
    case 'orphans': {
      // Reset the selection only when entering the cleanup view fresh from the matrix. A
      // refresh of an already-open view (requested above, or re-requested by the user)
      // instead intersects the previous selection with the new folder list, so checkmarks
      // for folders that are still present survive the refresh.
      const enteringFromMatrix = orphans === undefined;
      const freshNames = new Set(m.orphans.flatMap((o) => o.folders.map((f) => f.folderName)));
      orphans = m.orphans;
      checked = enteringFromMatrix ? new Set() : new Set([...checked].filter((name) => freshNames.has(name)));
      clearLocalBulkPending();
      render();
      return;
    }
    case 'cleanupResult': {
      const failed = m.results.filter((r) => !r.ok);
      orphans = undefined;
      if (failed.length > 0) alertBanner(`Could not remove: ${failed.map((f) => `${f.folderName} (${f.error ?? '?'})`).join(', ')}`);
      clearLocalBulkPending();
      render();
      return;
    }
    case 'unsupported':
      hideCard();
      app.replaceChildren(el('div', '', m.reason));
      return;
  }
});

function post(m: MatrixToHost): void {
  vscode.postMessage(m);
}

/** Drops only the `${extId}|*` bulk-action in-flight markers, leaving any single-cell
 * `${extId}|${profileId}` keys alone (those clear on the next 'inventory' instead). */
function clearLocalBulkPending(): void {
  for (const key of localPending) {
    if (key.endsWith('|*')) localPending.delete(key);
  }
}

function alertBanner(text: string): void {
  banner = text;
}

/** Host-pushed messages update the toolbar in place (labels/classes only — the filter input
 * itself is never touched) and then rebuild the content container. */
function render(): void {
  updateOrphanButton();
  renderContent();
}

function updateChipButtons(): void {
  for (const [key, b] of chipButtons) b.className = chip === key ? 'chip active' : 'chip';
}

function updateOrphanButton(): void {
  const count = inventory ? orphanCount(inventory) : 0;
  orphanButton.textContent = `Review ${count} orphaned…`;
  orphanButton.hidden = count === 0;
}

function renderContent(): void {
  contentEl.replaceChildren();
  if (!inventory) {
    renderedRows = [];
    hideCard();
    contentEl.append(el('div', '', 'Loading…'));
    return;
  }
  if (orphans !== undefined) {
    renderedRows = [];
    hideCard(); // the cleanup view has no extension names to anchor a card to
    renderCleanup(orphans);
    return;
  }

  const vm = buildViewModel(inventory, { filter, chip }, workspace);
  renderedRows = vm.rows;

  for (const w of vm.warnings) {
    // Metadata-only warnings (.obsolete, folder listing, package.json) disable nothing.
    const effect = w.affectedProfileIds.length > 0 ? ' — actions for affected profiles are disabled.' : '';
    contentEl.append(el('div', 'warning', `⚠ ${w.file}: ${w.message}${effect}`));
  }
  for (const warning of vm.workspaceWarnings) {
    contentEl.append(el('div', 'warning workspace-warning', `⚠ Current workspace: ${warning}`));
  }
  if (banner) {
    contentEl.append(el('div', 'warning', banner));
    banner = '';
  }

  if (vm.workspace) {
    const legend = el('div', 'workspace-legend');
    legend.setAttribute('aria-label', 'Current workspace extension status legend');
    legend.append(
      el('span', '', '✓ Enabled'),
      el('span', '', '○ Not enabled'),
      el('span', '', '— Not installed in profile'),
      el('span', '', '✓ W Workspace-local'),
      el('span', '', '? Unknown'),
    );
    contentEl.append(legend);
  }

  const table = document.createElement('table');
  const head = document.createElement('tr');
  head.append(el('th', 'ext-col', 'Extension'));
  for (const p of vm.profileNames) head.append(el('th', '', p.inherits ? `${p.name} ⤷` : p.name));
  if (vm.workspace) {
    const workspaceHead = el('th', 'workspace-col workspace-header');
    workspaceHead.append(
      el('span', 'workspace-header-title', 'Current workspace'),
      el('span', 'workspace-header-name', vm.workspace.name),
    );
    head.append(workspaceHead);
  }
  table.append(head);

  for (const row of vm.rows) {
    const tr = document.createElement('tr');
    const name = el('td', 'ext-col');
    name.append(extIcon(row.id, row.displayName));

    // The name itself is the hover-card trigger: hover (after a short delay) or keyboard focus
    // (immediate) opens the card with detail + the row's bulk actions.
    const nameTrigger = el('span', row.orphaned ? 'name orphaned' : 'name', row.displayName);
    nameTrigger.dataset['extId'] = row.id; // lets syncOpenCard re-anchor after a rebuild
    nameTrigger.tabIndex = 0;
    nameTrigger.setAttribute('role', 'button');
    nameTrigger.setAttribute('aria-haspopup', 'true');
    nameTrigger.addEventListener('mouseenter', () => scheduleShowCard(row.id, nameTrigger, 250));
    nameTrigger.addEventListener('mouseleave', () => {
      clearShowTimer();
      scheduleHideCard();
    });
    nameTrigger.addEventListener('focus', () => scheduleShowCard(row.id, nameTrigger, 0));
    nameTrigger.addEventListener('blur', (e) => {
      // Removal-fired blur: renderContent()'s replaceChildren() detaches this element while it
      // holds keyboard focus, and Chromium fires blur with relatedTarget null before
      // syncOpenCard can re-anchor the open card. That is not the user tabbing away — bail, or
      // the keyboard path would lose the card on every live refresh (the pointer path never
      // routes through blur).
      if (!nameTrigger.isConnected) return;
      const related = (e as FocusEvent).relatedTarget;
      if (related instanceof Node && card.contains(related)) return;
      hideCard();
    });
    // Redirect a forward Tab from the name into the open card instead of the next table cell —
    // otherwise the card's action buttons would be unreachable by keyboard even while visible.
    nameTrigger.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Tab' && !ke.shiftKey && cardOwnerExtId === row.id) {
        const firstFocusable = card.querySelector<HTMLElement>('a, button');
        if (firstFocusable) {
          ke.preventDefault();
          firstFocusable.focus();
        }
      }
    });
    name.append(nameTrigger);

    if (row.applyToAllProfiles) {
      const badge = el('button', 'badge', 'ALL');
      badge.title = 'Applied to all profiles — click for how to change';
      badge.addEventListener('click', () => post({ type: 'showApplyToAllProfilesGuide', extId: row.id }));
      name.append(badge);
    }

    tr.append(name);
    for (const cell of row.cells) {
      const key = `${row.id}|${cell.profileId}`;
      const isPending = pending.has(key) || localPending.has(key);
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
        box.addEventListener('change', () => {
          // Immediate "working" feedback — not optimistic UI: box.checked already reflects the
          // user's click, but the cell itself renders as pending (spinner + amber tint), not the
          // new checked state, the moment renderContent() below rebuilds it.
          localPending.add(key);
          renderContent();
          post({ type: 'toggleCell', extId: row.id, profileId: cell.profileId, install: box.checked });
        });
        td.append(box);
      }
      tr.append(td);
    }
    if (vm.workspace) {
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
        guide.addEventListener('click', () => post({ type: 'showWorkspaceEnablementGuide', extId: row.id }));
        td.append(guide);
      }
      const labelled = guide ?? td;
      labelled.append(el('span', 'workspace-symbol', symbol), el('span', 'sr-only', label));
      labelled.setAttribute('aria-label', `${label}. ${td.title}`);
      tr.append(td);
    }
    table.append(tr);
  }
  // Indexes for the crosshair highlight: every row has one cell per column (no spans), so a
  // cell's position is its column. Body rows count from 0, after the header row.
  [...table.rows].forEach((tr, i) => {
    if (i > 0) tr.dataset['row'] = String(i - 1);
    [...tr.cells].forEach((cellEl, col) => (cellEl.dataset['col'] = String(col)));
  });
  contentEl.append(table);

  // An open card survives the rebuild: re-anchored to the re-created name element and its
  // contents (including pending-disabled buttons) refreshed from the new state.
  syncOpenCard();
  applyCrosshair();
}

function renderCleanup(list: OrphanInfo[]): void {
  const back = el('button', 'chip', '← Back to matrix');
  back.addEventListener('click', () => {
    orphans = undefined;
    renderContent();
  });
  contentEl.append(
    back,
    el('h2', '', 'Orphaned extensions'),
    el('p', '', 'On disk but referenced by no profile. Selected folders are moved to the Recycle Bin/Trash after confirmation.'),
  );

  // Created before the rows so each checkbox's change handler can keep its disabled state in
  // sync with the live selection size instead of only setting it once at render time.
  const go = el('button', 'chip cleanup', 'Move selected to Recycle Bin/Trash…') as HTMLButtonElement;
  go.disabled = checked.size === 0;
  go.addEventListener('click', () => {
    if (checked.size > 0) post({ type: 'cleanup', folderNames: [...checked] });
  });

  for (const o of list) {
    for (const f of o.folders) {
      const row = el('label', 'orphan-row');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = checked.has(f.folderName);
      box.addEventListener('change', () => {
        if (box.checked) checked.add(f.folderName);
        else checked.delete(f.folderName);
        go.disabled = checked.size === 0;
      });
      row.append(
        box,
        el('span', 'name', `${o.displayName} `),
        el('span', 'orphan-meta', `${f.folderName} — ${formatBytes(f.sizeBytes)}, modified ${new Date(f.lastModifiedMs).toLocaleDateString()}`),
      );
      contentEl.append(row);
    }
  }
  contentEl.append(go);
}

/** Icon image when the host resolved one for this extension, otherwise a themed letter-tile
 * fallback. Also swaps a broken/unresolvable icon path to the fallback at load time, so a stale
 * or invalid host-provided URI never surfaces a broken-image glyph. */
function extIcon(extId: string, displayName: string): HTMLElement {
  const src = safeImageSource(icons[extId]);
  if (!src) return letterTile(displayName);
  const img = document.createElement('img');
  img.className = 'ext-icon';
  img.alt = '';
  img.addEventListener('error', () => img.replaceWith(letterTile(displayName)), { once: true });
  img.src = src;
  return img;
}

function letterTile(displayName: string): HTMLElement {
  const letter = displayName.trim().charAt(0).toUpperCase() || '?';
  return el('span', 'ext-icon ext-icon-fallback', letter);
}

render();
post({ type: 'ready' });
