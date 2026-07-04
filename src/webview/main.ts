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

const app = document.getElementById('app') as HTMLDivElement;

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const m = event.data;
  switch (m.type) {
    case 'inventory':
      inventory = m.inventory;
      toggleSupported = m.toggleSupported;
      pending = new Set();
      render();
      return;
    case 'pending':
      pending.add(`${m.extId}|${m.profileId}`);
      render();
      return;
    case 'orphans':
      orphans = m.orphans;
      checked = new Set();
      render();
      return;
    case 'cleanupResult': {
      const failed = m.results.filter((r) => !r.ok);
      orphans = undefined;
      if (failed.length > 0) alertBanner(`Could not remove: ${failed.map((f) => `${f.folderName} (${f.error ?? '?'})`).join(', ')}`);
      render();
      return;
    }
    case 'unsupported':
      app.textContent = m.reason;
      return;
  }
});

function post(m: WebviewToHost): void {
  vscode.postMessage(m);
}

let banner = '';
function alertBanner(text: string): void {
  banner = text;
}

function render(): void {
  if (!inventory) return;
  if (orphans !== undefined) {
    renderCleanup(orphans);
    return;
  }
  const vm = buildViewModel(inventory, { filter, chip });
  app.replaceChildren();

  for (const w of vm.warnings) {
    app.append(el('div', 'warning', `⚠ ${w.file}: ${w.message} — actions for affected profiles are disabled.`));
  }
  if (banner) {
    app.append(el('div', 'warning', banner));
    banner = '';
  }

  const toolbar = el('div', 'toolbar');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Filter extensions…';
  input.value = filter;
  input.addEventListener('input', () => {
    filter = input.value;
    render();
  });
  toolbar.append(input);
  for (const [key, label] of [['all', 'All'], ['orphaned', 'Orphaned'], ['allProfiles', 'All profiles']] as const) {
    const b = el('button', chip === key ? 'chip active' : 'chip', label);
    b.addEventListener('click', () => {
      chip = key;
      render();
    });
    toolbar.append(b);
  }
  if (vm.orphanCount > 0) {
    const c = el('button', 'chip cleanup', `Review ${vm.orphanCount} orphaned…`);
    c.addEventListener('click', () => post({ type: 'requestOrphans' }));
    toolbar.append(c);
  }
  app.append(toolbar);

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
  app.append(table);
}

function renderCleanup(list: OrphanInfo[]): void {
  app.replaceChildren();
  const back = el('button', 'chip', '← Back to matrix');
  back.addEventListener('click', () => {
    orphans = undefined;
    render();
  });
  app.append(back, el('h2', '', 'Orphaned extensions'), el('p', '', 'On disk but referenced by no profile. Selected folders are moved to the Recycle Bin/Trash after confirmation.'));

  for (const o of list) {
    for (const f of o.folders) {
      const row = el('label', 'orphan-row');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = checked.has(f.folderName);
      box.addEventListener('change', () => (box.checked ? checked.add(f.folderName) : checked.delete(f.folderName)));
      row.append(
        box,
        el('span', 'name', `${o.displayName} `),
        el('span', 'version', `${f.folderName} — ${formatBytes(f.sizeBytes)}, modified ${new Date(f.lastModifiedMs).toLocaleDateString()}`),
      );
      app.append(row);
    }
  }
  const go = el('button', 'chip cleanup', 'Move selected to Recycle Bin/Trash…');
  go.addEventListener('click', () => {
    if (checked.size > 0) post({ type: 'cleanup', folderNames: [...checked] });
  });
  app.append(go);
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

post({ type: 'ready' });
