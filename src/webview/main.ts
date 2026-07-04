import type { HostToWebview, Inventory, OrphanInfo, WebviewToHost } from '../core/types';
import { buildViewModel, formatBytes, type Chip } from './render';

declare function acquireVsCodeApi(): { postMessage(m: WebviewToHost): void };
const vscode = acquireVsCodeApi();

let inventory: Inventory | undefined;
let toggleSupported = false;
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
for (const [key, label] of [['all', 'All'], ['orphaned', 'Orphaned'], ['allProfiles', 'All profiles']] as const) {
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

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const m = event.data;
  switch (m.type) {
    case 'inventory':
      inventory = m.inventory;
      toggleSupported = m.toggleSupported;
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
    contentEl.append(el('div', '', 'Loading…'));
    return;
  }
  if (orphans !== undefined) {
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
    name.append(el('span', row.orphaned ? 'name orphaned' : 'name', row.displayName));
    name.append(el('span', 'version', row.version ? ` ${row.version}` : ''));
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
        el('span', 'version', `${f.folderName} — ${formatBytes(f.sizeBytes)}, modified ${new Date(f.lastModifiedMs).toLocaleDateString()}`),
      );
      contentEl.append(row);
    }
  }
  contentEl.append(go);
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

render();
post({ type: 'ready' });
