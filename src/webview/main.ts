import type { ExtensionRecord, HostToWebview, Inventory, OrphanInfo, WebviewToHost } from '../core/types';
import { buildViewModel, formatBytes, type Chip } from './render';

declare function acquireVsCodeApi(): { postMessage(m: WebviewToHost): void };
const vscode = acquireVsCodeApi();

let inventory: Inventory | undefined;
let toggleSupported = false;
let icons: Record<string, string> = {}; // extId -> webview URI, from the host's inventory push
let chip: Chip = 'all';
let filter = '';
let pending = new Set<string>(); // `${extId}|${profileId}`
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
for (const [key, label] of [['all', 'All'], ['orphaned', 'Orphaned'], ['allProfiles', 'Applied to all profiles']] as const) {
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
}

function showCard(extId: string, trigger: HTMLElement): void {
  clearShowTimer();
  cancelHide();
  if (!inventory) return;
  // A pending show timer can outlive a content rebuild — its captured trigger element is then
  // detached and would position the card at (0,0). Ignore it; the re-created element gets its
  // own listeners.
  if (!trigger.isConnected) return;
  const ext = inventory.extensions.find((e) => e.id === extId);
  if (!ext) return;
  cardOwnerExtId = extId;
  rebuildCard(ext);
  card.hidden = false;
  positionCard(trigger);
}

/** True while buildCardContent is replacing the card's children — the removal of a focused
 * child fires a focusout with no in-card relatedTarget, which must not be mistaken for the
 * user tabbing away (it would close the card on every live refresh for keyboard users). */
let rebuildingCard = false;

function rebuildCard(ext: ExtensionRecord): void {
  rebuildingCard = true;
  try {
    buildCardContent(ext);
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
  const ext = inventory?.extensions.find((e) => e.id === cardOwnerExtId);
  const trigger = contentEl.querySelector<HTMLElement>(`.name[data-ext-id="${CSS.escape(cardOwnerExtId)}"]`);
  if (!ext || !trigger) {
    hideCard();
    return;
  }

  // If keyboard focus was inside the card, the rebuild is about to drop it to <body>, which
  // would leave an open card that no longer closes on tab-away. Remember which control held
  // focus (by its stable data-action name) and restore it after the rebuild — falling back to
  // the card container itself (tabindex=-1) when the control no longer exists (e.g. the
  // extension became app-scoped and install/remove disappeared). Escape still closes either way.
  const active = document.activeElement;
  const focusedAction =
    active instanceof HTMLElement && card.contains(active) ? active.dataset['action'] : undefined;
  const focusWasInCard = active instanceof HTMLElement && card.contains(active);

  rebuildCard(ext);
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

function buildCardContent(ext: ExtensionRecord): void {
  card.replaceChildren();

  const header = el('div', 'ext-card-header');
  header.append(extIcon(ext.id, ext.displayName));
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
  card.append(header);

  const publisherText = ext.publisherDisplayName ?? ext.publisher;
  if (publisherText) card.append(el('div', 'ext-card-publisher', publisherText));

  if (ext.description) card.append(el('div', 'ext-card-description', ext.description));

  const latestVersion = ext.versions[ext.versions.length - 1]?.version;
  if (latestVersion) {
    const metaParts = [`v${latestVersion}`];
    // "installed" is the local install time from offline metadata, not a marketplace publish date.
    if (ext.installedTimestampMs !== undefined) {
      metaParts.push(`installed ${new Date(ext.installedTimestampMs).toLocaleDateString()}`);
    }
    card.append(el('div', 'ext-card-meta', metaParts.join(' · ')));
  }

  const rowPending = [...pending].some((key) => key.startsWith(`${ext.id}|`));
  const actions = el('div', 'ext-card-actions');
  if (!ext.applyToAllProfiles) {
    const installAllBtn = el('button', 'row-action', 'Install in all profiles') as HTMLButtonElement;
    installAllBtn.dataset['action'] = 'install-everywhere';
    installAllBtn.title =
      "Install in every profile via the VS Code CLI. Unlike VS Code's native 'apply to all profiles' flag, future new profiles will not inherit it.";
    installAllBtn.disabled = rowPending;
    installAllBtn.addEventListener('click', () => post({ type: 'installEverywhere', extId: ext.id }));
    actions.append(installAllBtn);

    const removeAllBtn = el('button', 'row-action', 'Remove from all profiles') as HTMLButtonElement;
    removeAllBtn.dataset['action'] = 'remove-everywhere';
    removeAllBtn.title = 'Uninstall from every profile where it is directly installed.';
    removeAllBtn.disabled = rowPending;
    removeAllBtn.addEventListener('click', () => post({ type: 'removeEverywhere', extId: ext.id }));
    actions.append(removeAllBtn);
  }
  const applyAllBtn = el('button', 'row-action', 'Apply to all profiles…') as HTMLButtonElement;
  applyAllBtn.dataset['action'] = 'apply-all';
  applyAllBtn.title =
    "Opens the Extensions view where you can toggle VS Code's native 'Apply Extension to all Profiles' option — VS Code provides no API for extensions to toggle it directly.";
  applyAllBtn.disabled = rowPending;
  applyAllBtn.addEventListener('click', () => post({ type: 'toggleAllProfiles', extId: ext.id }));
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

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  if (event.origin !== window.location.origin) return;

  const m = event.data;
  switch (m.type) {
    case 'inventory':
      inventory = m.inventory;
      toggleSupported = m.toggleSupported;
      icons = m.icons;
      pending = new Set();
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
      render();
      return;
    }
    case 'cleanupResult': {
      const failed = m.results.filter((r) => !r.ok);
      orphans = undefined;
      if (failed.length > 0) alertBanner(`Could not remove: ${failed.map((f) => `${f.folderName} (${f.error ?? '?'})`).join(', ')}`);
      render();
      return;
    }
    case 'unsupported':
      hideCard();
      app.replaceChildren(el('div', '', m.reason));
      return;
  }
});

function post(m: WebviewToHost): void {
  vscode.postMessage(m);
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
  const count = inventory ? inventory.extensions.filter((e) => e.orphaned).length : 0;
  orphanButton.textContent = `Review ${count} orphaned…`;
  orphanButton.hidden = count === 0;
}

function renderContent(): void {
  contentEl.replaceChildren();
  if (!inventory) {
    hideCard();
    contentEl.append(el('div', '', 'Loading…'));
    return;
  }
  if (orphans !== undefined) {
    hideCard(); // the cleanup view has no extension names to anchor a card to
    renderCleanup(orphans);
    return;
  }

  const vm = buildViewModel(inventory, { filter, chip });

  for (const w of vm.warnings) {
    contentEl.append(el('div', 'warning', `⚠ ${w.file}: ${w.message} — actions for affected profiles are disabled.`));
  }
  if (banner) {
    contentEl.append(el('div', 'warning', banner));
    banner = '';
  }

  const table = document.createElement('table');
  const head = document.createElement('tr');
  head.append(el('th', 'ext-col', 'Extension'));
  for (const p of vm.profileNames) head.append(el('th', '', p.inherits ? `${p.name} ⤷` : p.name));
  table.append(head);

  for (const row of vm.rows) {
    const tr = document.createElement('tr');
    const name = el('td', 'ext-col');
    name.append(extIcon(row.extId, row.displayName));

    // The name itself is the hover-card trigger: hover (after a short delay) or keyboard focus
    // (immediate) opens the card with detail + the row's bulk actions.
    const nameTrigger = el('span', row.orphaned ? 'name orphaned' : 'name', row.displayName);
    nameTrigger.dataset['extId'] = row.extId; // lets syncOpenCard re-anchor after a rebuild
    nameTrigger.tabIndex = 0;
    nameTrigger.setAttribute('role', 'button');
    nameTrigger.setAttribute('aria-haspopup', 'true');
    nameTrigger.addEventListener('mouseenter', () => scheduleShowCard(row.extId, nameTrigger, 250));
    nameTrigger.addEventListener('mouseleave', () => {
      clearShowTimer();
      scheduleHideCard();
    });
    nameTrigger.addEventListener('focus', () => scheduleShowCard(row.extId, nameTrigger, 0));
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
      if (ke.key === 'Tab' && !ke.shiftKey && cardOwnerExtId === row.extId) {
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
      badge.title = toggleSupported ? 'Applied to all profiles — click to toggle' : 'Applied to all profiles — click for how to change';
      badge.addEventListener('click', () => post({ type: 'toggleAllProfiles', extId: row.extId }));
      name.append(badge);
    }

    tr.append(name);
    for (const cell of row.cells) {
      const td = el('td', 'cell');
      const key = `${row.extId}|${cell.profileId}`;
      if (pending.has(key)) {
        td.append(el('span', 'spinner', '◐'));
      } else if (cell.disabled) {
        td.append(el('span', 'inherited', cell.installed ? '✓' : '—'));
        td.title = 'This profile\'s extension list could not be read — actions are disabled.';
      } else if (cell.inherited) {
        td.append(el('span', 'inherited', cell.installed ? '✓' : ''));
        td.title = 'This profile inherits the default profile\'s extensions.';
      } else if (row.applyToAllProfiles) {
        td.append(el('span', 'inherited', '✓'));
        td.title = 'Applied to all profiles — use the ALL badge to change.';
      } else {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = cell.installed;
        box.addEventListener('change', () =>
          post({ type: 'toggleCell', extId: row.extId, profileId: cell.profileId, install: box.checked }),
        );
        td.append(box);
      }
      tr.append(td);
    }
    table.append(tr);
  }
  contentEl.append(table);

  // An open card survives the rebuild: re-anchored to the re-created name element and its
  // contents (including pending-disabled buttons) refreshed from the new state.
  syncOpenCard();
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
  const src = icons[extId];
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

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

render();
post({ type: 'ready' });
