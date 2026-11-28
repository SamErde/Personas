import type { Inventory, OrphanInfo, WorkspaceInventory } from '../core/types';
import type { HostToMatrix, MatrixFilters, MatrixGroupBy, MatrixToHost, MatrixView } from '../protocol';
import { orphanCount } from '../core/inventoryQueries';
import { buildViewModel, NO_FILTERS, type RowVm } from './render';
import { crosshairFor, gridHitAt, paintCrosshair } from './crosshair';
import { renderMatrixTable } from './matrixTable';
import { focusMatrixControl, preserveMatrixFocus } from './matrixFocus';
import { createFilterControls } from './matrixFilters';
import { createLegendControls } from './matrixLegend';
import { groupRows, isMatrixGroupBy } from './matrixGroups';
import { el, formatBytes } from './ui';
import { isTrustedHostMessageOrigin, safeImageSource } from './messageSecurity';

declare function acquireVsCodeApi(): { postMessage(m: MatrixToHost): void };
const vscode = acquireVsCodeApi();

let inventory: Inventory | undefined;
let workspace: WorkspaceInventory | undefined;
let renderedRows: RowVm[] = [];
let icons: Record<string, string> = {}; // extId -> webview URI, from the host's inventory push
let experimentalApplyToAllProfilesIds = new Set<string>();
let filters: MatrixFilters = NO_FILTERS;
let groupBy: MatrixGroupBy = 'none';
/** The count announced after a filter change, from the last rebuild of the matrix. */
let shownCount: { shown: number; total: number } | undefined;
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
// and the filter input is left alone by every code path except its own listener and the view
// state the host sends once to a newly opened panel.
app.replaceChildren();

const toolbar = el('div', 'toolbar');

/** Typing waits this long for a pause before the table is rebuilt. */
const FILTER_DEBOUNCE_MS = 200;
let filterTimer: ReturnType<typeof setTimeout> | undefined;

const filterInput = document.createElement('input');
filterInput.type = 'search';
// Short enough for the box's default width; the accessible name below gives the full description.
filterInput.placeholder = 'Filter extensions…';
filterInput.setAttribute('aria-label', 'Filter extensions by name, ID, or publisher');
filterInput.addEventListener('input', () => {
  // The text is kept, and given to the host, at once, so a rebuild for a host message uses it and
  // closing the panel mid-typing loses nothing. Only the rebuild the typing asks for waits.
  filters = { ...filters, text: filterInput.value };
  keepViewState();
  clearFilterTimer();
  filterTimer = setTimeout(() => {
    filterTimer = undefined;
    applyFilterChange();
  }, FILTER_DEBOUNCE_MS);
});
toolbar.append(filterInput);

function clearFilterTimer(): void {
  if (filterTimer !== undefined) {
    clearTimeout(filterTimer);
    filterTimer = undefined;
  }
}

// The view buttons are one joined group. There is no Orphaned view: "Review N orphaned…" covers orphans.
const viewGroup = el('div', 'view-group');
viewGroup.setAttribute('role', 'group');
viewGroup.setAttribute('aria-label', 'View');
const chipButtons: [MatrixView, HTMLElement][] = [];
for (const [key, label] of [['all', 'All'], ['appliedToAllProfiles', 'Applied to all profiles']] as const) {
  const b = el('button', 'chip', label);
  b.addEventListener('click', () => changeFilters({ view: key }));
  chipButtons.push([key, b]);
  viewGroup.append(b);
}
toolbar.append(viewGroup);
updateChipButtons();

// Category, publisher, and source filters: one Filters disclosure beside the view chips, because
// three separate buttons wrapped the toolbar at a 1,000px panel width.
const filterControls = createFilterControls(changeFilters);
toolbar.append(filterControls.toggle);

// Group by arranges the rows the filters chose, so it sits with the filters. A native select needs no
// custom keyboard model, and it is built once, like the filter box, so a rebuild never takes its focus.
const groupBySelect = document.createElement('select');
const GROUP_BY_LABELS: Readonly<Record<MatrixGroupBy, string>> = { none: 'None', name: 'Name', publisher: 'Publisher' };
for (const [value, label] of Object.entries(GROUP_BY_LABELS)) groupBySelect.append(new Option(label, value));
groupBySelect.addEventListener('change', () => {
  if (isMatrixGroupBy(groupBySelect.value)) groupBy = groupBySelect.value;
  keepViewState();
  renderContent();
});
const groupByLabel = el('label', 'group-by', 'Group by ');
groupByLabel.append(groupBySelect);
toolbar.append(groupByLabel);

const orphanButton = el('button', 'chip cleanup', '');
orphanButton.hidden = true;
orphanButton.addEventListener('click', () => post({ type: 'requestOrphans' }));
toolbar.append(orphanButton);

// The legend sits behind its own disclosure beside Refresh, so the key is there when wanted without
// standing between the toolbar and the table. Keep it right after the orphan button: style.css
// right-aligns it (`.chip.cleanup[hidden] + .chip`) whenever that button is hidden.
const legend = createLegendControls();
toolbar.append(legend.toggle);

const refreshButton = el('button', 'chip refresh', '↻ Refresh');
refreshButton.title = 'Refresh from disk';
refreshButton.addEventListener('click', () => post({ type: 'refresh' }));
toolbar.append(refreshButton);

// Announces the result count after a filter change. It lives outside `contentEl` because a live
// region must stay in the document to be announced.
const resultStatus = el('div', 'sr-only');
resultStatus.setAttribute('role', 'status');
resultStatus.setAttribute('aria-live', 'polite');

const contentEl = el('div', 'content');
app.append(toolbar, filterControls.panel, legend.panel, filterControls.chips, resultStatus, contentEl);
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
  // Like preserveMatrixFocus, it restores nothing while the webview does not own focus, so a
  // refresh never pulls focus back from the editor.
  const active = document.activeElement;
  const focusWasInCard = document.hasFocus() && active instanceof HTMLElement && card.contains(active);
  const focusedAction = focusWasInCard ? active.dataset['action'] : undefined;

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
  if (!ext.applyToAllProfiles && experimentalApplyToAllProfilesIds.has(ext.id)) {
    const experimentalBtn = el(
      'button',
      'row-action',
      'Apply to all profiles (Experimental)…',
    ) as HTMLButtonElement;
    experimentalBtn.dataset['action'] = 'apply-all-experimental';
    experimentalBtn.title =
      'Uses an undocumented VS Code command after confirmation, then verifies the saved state.';
    experimentalBtn.disabled = rowPending;
    experimentalBtn.classList.toggle('in-flight', bulkInFlight);
    experimentalBtn.addEventListener('click', () => {
      localPending.add(bulkKey);
      renderContent();
      post({ type: 'applyToAllProfiles', extId: ext.id });
    });
    actions.append(experimentalBtn);
  }

  const guideLabel = ext.applyToAllProfiles
    ? 'Change in VS Code…'
    : experimentalApplyToAllProfilesIds.has(ext.id)
      ? 'Use VS Code instead…'
      : 'Apply to all profiles…';
  const applyAllGuide = el('button', 'row-action', guideLabel) as HTMLButtonElement;
  applyAllGuide.dataset['action'] = 'apply-all-guide';
  applyAllGuide.title =
    "Opens the Extensions view where you can use VS Code's native 'Apply Extension to all Profiles' option.";
  applyAllGuide.disabled = rowPending;
  applyAllGuide.addEventListener('click', () => post({ type: 'showApplyToAllProfilesGuide', extId: ext.id }));
  actions.append(applyAllGuide);
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
// Escape closes the card. When focus was in the card, it returns to the extension name that owns
// the card, since hiding the card would otherwise drop it to <body>. Focus elsewhere stays put.
document.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key !== 'Escape' || card.hidden) return;
  const owner = cardFocusOwner();
  hideCard();
  if (owner !== undefined) withRestoringFocus(() => focusMatrixControl(contentEl, { extId: owner, slot: 'name' }));
});

/** The extension whose open card holds keyboard focus, if any. */
function cardFocusOwner(): string | undefined {
  return card.contains(document.activeElement) ? cardOwnerExtId : undefined;
}
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
// every render) and keyed by the `data-row` / `data-col` indexes renderMatrixTable() stamps on
// the table. Nothing about the hit itself is stored: each apply re-reads the element under the last
// pointer position and the live `document.activeElement`, so a rebuild can't leave a stale row
// or column behind (a focused checkbox removed by a rebuild fires its focusout while detached,
// which never reaches `contentEl`).
let pointerAt: { x: number; y: number } | undefined; // last position while over contentEl

/** Data-row index, in the order shown, of the extension whose hover card is open, if it is rendered. */
function openCardRow(): number | undefined {
  if (card.hidden) return undefined;
  const index = renderedRows.findIndex((r) => r.id === cardOwnerExtId);
  return index >= 0 ? index : undefined;
}

function applyCrosshair(): void {
  paintCrosshair(
    contentEl,
    crosshairFor({
      pointer: pointerAt && gridHitAt(document.elementFromPoint(pointerAt.x, pointerAt.y), contentEl),
      focus: gridHitAt(document.activeElement, contentEl),
      cardRow: openCardRow(),
    }),
  );
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
      // Here rather than in buildContent, which skips the matrix while the cleanup view is open.
      legend.update(workspace !== undefined);
      icons = m.icons;
      experimentalApplyToAllProfilesIds = new Set(
        m.experimentalApplyToAllProfiles?.eligibleExtensionIds ?? [],
      );
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
    case 'viewState':
      // A newly opened panel returns to the session's last view. Nothing is announced or sent
      // back, because the person did not change anything.
      clearFilterTimer();
      filters = { ...NO_FILTERS, ...m.state.filters };
      groupBy = isMatrixGroupBy(m.state.groupBy) ? m.state.groupBy : 'none';
      filterInput.value = filters.text;
      groupBySelect.value = groupBy;
      updateChipButtons();
      renderContent();
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

/** Shows the selected view by more than color: aria-pressed tells assistive technology too. */
function updateChipButtons(): void {
  for (const [key, b] of chipButtons) {
    b.className = filters.view === key ? 'chip active' : 'chip';
    b.setAttribute('aria-pressed', String(filters.view === key));
  }
}

/** Rebuilds the table for a filter the person changed and announces the result count. The cleanup
 * view has no count, so the region is emptied rather than left holding an old one. */
function applyFilterChange(): void {
  renderContent();
  resultStatus.textContent = shownCount ? `${shownCount.shown} of ${shownCount.total} extensions` : '';
}

/** Applies a change the person made to the view or the filters: keeps it with the host, shows it
 * in the view chips, rebuilds the matrix, and announces the count. */
function changeFilters(next: Partial<MatrixFilters>): void {
  filters = { ...filters, ...next };
  keepViewState();
  updateChipButtons();
  clearFilterTimer(); // this rebuild also applies any text still waiting for a pause
  applyFilterChange();
}

/** Gives the host the current view state to keep for the session. */
function keepViewState(): void {
  post({ type: 'viewState', state: { filters, groupBy } });
}

function updateOrphanButton(): void {
  const count = inventory ? orphanCount(inventory) : 0;
  orphanButton.textContent = `Review ${count} orphaned…`;
  orphanButton.hidden = count === 0;
}

/** True while focus is moved by code (restored after a rebuild, or returned by Escape) rather
 * than by the user, so a name receiving it does not open its hover card. */
let restoringFocus = false;

function withRestoringFocus(action: () => void): void {
  restoringFocus = true;
  try {
    action();
  } finally {
    restoringFocus = false;
  }
}

/** Rebuilds the content container, keeping keyboard focus on the same matrix control. Focus in
 * the hover card belongs to its extension's name: syncOpenCard keeps it in the card, and when the
 * card closes because the row is gone, it moves to the nearest remaining row instead of <body>. */
function renderContent(): void {
  const owner = cardFocusOwner();
  const heldFor = owner === undefined ? undefined : { extId: owner, slot: 'name' as const };
  withRestoringFocus(() => preserveMatrixFocus(contentEl, buildContent, heldFor));
}

function buildContent(): void {
  contentEl.replaceChildren();
  shownCount = undefined; // only the matrix view has a count to announce
  // Leaving the matrix also empties the announcement, so the cleanup view never holds an old count.
  // The filter controls show the filters at once, keeping their last counts until the matrix is back.
  if (!inventory || orphans !== undefined) {
    resultStatus.textContent = '';
    filterControls.update(filters);
  }
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

  const vm = buildViewModel(inventory, filters, workspace);
  filterControls.update(filters, vm.facets);
  // The hover card and the crosshair index rows in the order shown, which grouping changes.
  const groups = groupRows(vm.rows, groupBy, vm.facets.publishers);
  renderedRows = groups.flatMap((group) => group.rows);
  shownCount = { shown: vm.rows.length, total: vm.total };

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

  contentEl.append(
    renderMatrixTable(vm, {
      icon: extIcon,
      isPending: (extId, profileId) => {
        const key = `${extId}|${profileId}`;
        return pending.has(key) || localPending.has(key);
      },
      attachHoverCard,
      toggleCell: (extId, profileId, install) => {
        // Immediate "working" feedback, not optimistic UI: the box already reflects the user's
        // click, but the cell renders as pending (spinner and tint), not the new checked state,
        // the moment renderContent() below rebuilds it.
        localPending.add(`${extId}|${profileId}`);
        renderContent();
        post({ type: 'toggleCell', extId, profileId, install });
      },
      showApplyToAllProfilesGuide: (extId) => post({ type: 'showApplyToAllProfilesGuide', extId }),
      showWorkspaceEnablementGuide: (extId) => post({ type: 'showWorkspaceEnablementGuide', extId }),
    }, groups),
  );

  // An open card survives the rebuild: re-anchored to the re-created name element and its
  // contents (including pending-disabled buttons) refreshed from the new state.
  syncOpenCard();
  applyCrosshair();
}

/** Attaches the hover card to an extension's name in the table. Hovering (after a short delay) or
 * keyboard focus (immediately) opens the card with detail and the row's bulk actions. */
function attachHoverCard(nameTrigger: HTMLElement, row: RowVm): void {
  nameTrigger.addEventListener('mouseenter', () => scheduleShowCard(row.id, nameTrigger, 250));
  nameTrigger.addEventListener('mouseleave', () => {
    clearShowTimer();
    scheduleHideCard();
  });
  nameTrigger.addEventListener('focus', () => {
    if (!restoringFocus) scheduleShowCard(row.id, nameTrigger, 0);
  });
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
  nameTrigger.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    // Redirect a forward Tab from the name into the open card instead of the next table cell —
    // otherwise the card's action buttons would be unreachable by keyboard even while visible.
    if (ke.key === 'Tab' && !ke.shiftKey && cardOwnerExtId === row.id) {
      const firstFocusable = card.querySelector<HTMLElement>('a, button');
      if (firstFocusable) {
        ke.preventDefault();
        firstFocusable.focus();
      }
      return;
    }
    // The name is a button, so every way of activating it opens its card: Enter and Space, and a
    // click, which is also how a screen reader in browse mode activates a button. That is the way
    // back to the card after Escape, or after focus was restored to a name without opening it.
    if (ke.key === 'Enter' || ke.key === ' ') {
      ke.preventDefault();
      showCard(row.id, nameTrigger);
    }
  });
  nameTrigger.addEventListener('click', () => showCard(row.id, nameTrigger));
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
