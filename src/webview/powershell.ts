import type { HomeToHost } from '../protocol';
import type { PowerShellInventory, ProfileRow } from '../powershell/profiles';
import { el } from './ui';

type Send = (message: HomeToHost) => void;
function button(label: string, action: () => void, title = label): HTMLButtonElement {
  const result = el('button', 'ps-action', label) as HTMLButtonElement;
  result.dataset.psAction = label === '+' || label === '✎' ? 'open-icon' : label === 'Resolve Using PowerShell…' ? title : label;
  result.type = 'button'; result.title = title; result.setAttribute('aria-label', title);
  result.addEventListener('click', action);
  return result;
}
export function renderPowerShell(inventory: PowerShellInventory, send: Send): void {
  const root = document.getElementById('powershell');
  if (!root) return;
  const restoreInteraction = preserveInteraction(root);
  const dispatch = (action: Extract<HomeToHost, {type:'powerShellAction'}>['action'], id?: string) =>
    send({type:'powerShellAction', action, id});
  root.replaceChildren();
  const toolbar = el('div', 'ps-toolbar');
  toolbar.append(button('Refresh', () => dispatch('refresh')), button('Help', () => dispatch('help'), 'About PowerShell profiles'));
  root.append(toolbar);
  if (inventory.error) { root.append(el('p', '', inventory.error)); restoreInteraction(); return; }
  const order = el('p', 'profile-counts', 'Load order for one host: All Users / All Hosts → All Users / host → Current User / All Hosts → Current User / host. Changes apply to subsequent sessions.');
  root.append(order);
  for (const edition of inventory.editions) {
    root.append(el('h3', '', edition.edition));
    if (edition.reason) root.append(el('p', 'profile-counts', edition.reason));
    for (const installation of edition.installations) {
      if (!edition.userDirectory || !installation.home) root.append(button(
        'Resolve Using PowerShell…', () => dispatch('resolve', installation.id),
        'Launch ' + installation.executable + ' with profiles disabled to resolve paths (5-second timeout).',
      ));
    }
    const rows = inventory.rows.filter(row => row.edition === edition.edition);
    const user = rows.filter(row => row.scope === 'Current User');
    root.append(el('h4', '', 'Current User'), ...user.map(row => renderRow(row, dispatch)));
    if (edition.installations.length > 1) {
      root.append(el('h4', '', 'All Users'));
      for (const installation of edition.installations) {
        const label = el('p', 'profile-counts', installation.home ?? installation.executable);
        label.title = installation.executable;
        root.append(label, ...rows.filter(row => row.scope === 'All Users' && row.installation === installation.id).map(row => renderRow(row, dispatch)));
      }
    } else if (edition.installations.length) {
      root.append(el('h4', '', 'All Users'), ...rows.filter(row => row.scope === 'All Users').map(row => renderRow(row, dispatch)));
    }
  }
  restoreInteraction();
}
function renderRow(
  row: ProfileRow, dispatch: (action: Extract<HomeToHost, {type:'powerShellAction'}>['action'], id?: string) => void,
): HTMLElement {
  const root = el('div', 'ps-row');
  root.dataset.psRow = row.id;
  const standard = (row.scope === 'Current User' ? 'CurrentUser' : 'AllUsers') + (row.host === 'All Hosts' ? 'AllHosts' : 'CurrentHost');
  const hint = row.host === 'VS Code' ? '\nUsed by the PowerShell extension session, not an ordinary pwsh terminal.' : '';
  const tooltip = [row.edition, standard + ' — ' + row.host, row.path ?? row.detail ?? 'Path unresolved',
    row.installation ?? '', row.target ? 'Link target: ' + row.target : '', hint].filter(Boolean).join('\n');
  const open = button(row.host, () => dispatch('open', row.id), tooltip);
  open.classList.add('ps-name');
  open.disabled = !(row.state === 'existing' || row.state === 'missing' && !row.readOnly);
  if (row.state === 'missing') open.classList.add('ps-missing');
  root.append(open);
  if (!open.disabled) root.append(button(row.state === 'missing' ? '+' : '✎', () => dispatch('open', row.id),
    (row.state === 'missing' ? 'Create and open ' : 'Edit ') + row.host + ' — ' + row.scope));
  const labels = {existing:'',missing:'Not created',unresolved:'Unresolved',inaccessible:'Unavailable',brokenLink:'Broken link'};
  const status = [labels[row.state], row.readOnly ? 'Read-only location' : '', row.target ? 'Link' : ''].filter(Boolean).join(' · ');
  if (status) { const description = el('span', 'profile-counts', status); description.title = row.detail ?? tooltip; root.append(description); }
  if (row.path) {
    const menu = document.createElement('details'); menu.className = 'ps-menu';
    const summary = document.createElement('summary'); summary.textContent = '⋯'; summary.dataset.psAction = 'menu';
    summary.title = 'Actions for ' + row.host; summary.setAttribute('aria-label', summary.title);
    menu.append(summary);
    const actions = el('div', 'ps-menu-actions');
    actions.append(button('Copy Path', () => {menu.open=false;dispatch('copy',row.id);}),
      button('Reveal in File Manager', () => {menu.open=false;dispatch('reveal',row.id);}));
    if (['existing','brokenLink'].includes(row.state) && !row.readOnly) {
      const remove = button('Delete PowerShell Profile…', () => {menu.open=false;dispatch('delete',row.id);});
      // Link-only Trash behavior is not guaranteed by VS Code's public API.
      if (row.target) { remove.disabled=true; remove.title='Recoverable link-only deletion is unavailable; use Reveal in File Manager.'; }
      actions.append(remove);
    }
    menu.append(actions); root.append(menu);
    root.addEventListener('contextmenu', event => {event.preventDefault();menu.open=true;actions.querySelector('button')?.focus();});
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {menu.open=false;summary.focus();}
      if (event.key === 'F10' && event.shiftKey) {event.preventDefault();menu.open=true;actions.querySelector('button')?.focus();}
    });
  }
  return root;
}

/** Restore only controls that survive a refresh; never steal focus from elsewhere. */
function preserveInteraction(root: HTMLElement): () => void {
  const rowId = (element: Element): string => (element.closest('[data-ps-row]') as HTMLElement | null)?.dataset.psRow ?? '';
  const key = (element: HTMLElement): string => JSON.stringify([rowId(element), element.dataset.psAction]);
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && root.contains(active) ? active : undefined;
  const focusedKey = focused ? key(focused) : undefined;
  const focusedRow = focused ? rowId(focused) : undefined;
  const openRows = new Set(Array.from(root.querySelectorAll('details[open]')).map(rowId));
  return () => {
    for (const menu of root.querySelectorAll('details')) menu.open = openRows.has(rowId(menu));
    if (!focusedKey) return;
    const controls = Array.from(root.querySelectorAll<HTMLElement>('button, summary')).filter(control => !control.matches(':disabled'));
    const replacement = controls.find(control => key(control) === focusedKey)
      ?? controls.find(control => focusedRow && rowId(control) === focusedRow)
      ?? controls[0];
    replacement?.focus({preventScroll:true});
  };
}
