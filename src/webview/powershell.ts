import type { PowerShellAction } from '../protocol';
import type { EditionInfo, Installation, PowerShellInventory, ProfileRow } from '../powershell/profiles';
import { el } from './ui';

type Send = (message: PowerShellAction) => void;
type Action = PowerShellAction['action'];

/**
 * The PowerShell Profiles view of Home, drawn as a compact list in the manner of VS Code's own
 * views. PowerShell profiles that exist are rows; locations with no script yet sit behind one
 * collapsed line per edition. A row's single primary action opens the script, and everything else
 * lives in a menu that overlays the list. The view redraws whenever files change on disk, so
 * focus, open menus, and expanded lists are carried across each redraw.
 */

let post: Send | undefined;
function dispatch(action: Action, id?: string): void {
  post?.({ type: 'powerShellAction', action, id });
}

/** Outlines drawn for this view on a 16-pixel grid. Strokes take the current text color. */
const iconPaths = {
  script: 'M3.25 2.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5ZM4.5 6 7 8l-2.5 2M8.5 10.25h3',
  add: 'M8 3.5v9M3.5 8h9',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  chevron: 'M6 4l4 4-4 4',
  warning: 'M8 2.5 14.25 13.25H1.75ZM8 6.5v3M8 11.25v.01',
  lock: 'M4.25 7.25h7.5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1ZM5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75',
  unknown: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2ZM3.8 12.2l8.4-8.4',
};
type IconName = keyof typeof iconPaths;

function icon(name: IconName): SVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('class', `ps-icon ps-icon-${name}`);
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', iconPaths[name]);
  svg.append(path);
  return svg;
}

function button(className: string, action: string, onClick: () => void): HTMLButtonElement {
  const result = el('button', className) as HTMLButtonElement;
  result.type = 'button';
  result.dataset.psAction = action;
  result.addEventListener('click', onClick);
  return result;
}

function describe(control: HTMLElement, name: string, tooltip = name): void {
  control.setAttribute('aria-label', name);
  control.title = tooltip;
}

export function renderPowerShell(inventory: PowerShellInventory, send: Send, allowRuntimeDiscovery: boolean): void {
  const root = document.getElementById('powershell');
  if (!root) return;
  post = send;
  listenOnce(root);
  const restoreInteraction = captureInteraction(root);
  root.replaceChildren();
  if (inventory.error) {
    root.append(el('p', 'ps-message', inventory.error));
  } else {
    for (const edition of inventory.editions) {
      root.append(renderEdition(edition, inventory.rows.filter(row => row.edition === edition.edition), allowRuntimeDiscovery));
    }
    if (!allowRuntimeDiscovery && inventory.editions.some(edition => edition.installations.some(i => !edition.userDirectory || !i.home))) {
      root.append(el('p', 'ps-message', 'Runtime discovery is off'));
    }
  }
  restoreInteraction();
}

function renderEdition(edition: EditionInfo, rows: ProfileRow[], allowRuntimeDiscovery: boolean): HTMLElement {
  const group = el('div', 'ps-edition');
  group.dataset.psEdition = edition.edition;
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', `${edition.edition} PowerShell profiles`);
  group.append(el('h3', 'ps-edition-name', edition.edition));

  // about_Profiles load order: All Users before Current User, and All Hosts before a specific host.
  const ordered = [...rows.filter(row => row.scope === 'All Users'), ...rows.filter(row => row.scope === 'Current User')];
  const names = installationNames(edition.installations);
  const render = (row: ProfileRow) => renderRow(row, row.installation ? names.get(row.installation) : undefined);
  // The collapsed line lists what can be created first, in the order its label counts them.
  const folded = [...ordered.filter(row => row.state === 'missing'), ...ordered.filter(row => row.state === 'unresolved')];
  const shown = ordered.filter(row => !folded.includes(row));

  if (shown.length) {
    const list = el('ul', 'ps-list');
    list.append(...shown.map(render));
    group.append(list);
  }
  group.append(...renderNotices(edition, names, allowRuntimeDiscovery));
  if (folded.length) {
    const missing = folded.filter(row => row.state === 'missing').length;
    const unresolved = folded.length - missing;
    const label = [missing ? `${missing} not created` : '', unresolved ? `${unresolved} unresolved` : ''].filter(Boolean).join(' · ');
    const list = el('ul', 'ps-list ps-folded');
    list.hidden = true;
    list.append(...folded.map(render));
    const fold = button('ps-fold', 'fold', () => setFold(fold, fold.getAttribute('aria-expanded') !== 'true'));
    fold.dataset.psNav = '';
    fold.setAttribute('aria-expanded', 'false');
    describe(fold, `${label}: ${edition.edition} PowerShell profile locations`,
      `Show or hide the ${edition.edition} locations that have no PowerShell profile yet`);
    fold.append(icon('chevron'), el('span', 'ps-fold-label', label));
    group.append(fold, list);
  }
  return group;
}

function setFold(fold: HTMLElement, expanded: boolean): void {
  fold.setAttribute('aria-expanded', String(expanded));
  const list = fold.nextElementSibling;
  if (list instanceof HTMLElement) list.hidden = !expanded;
}

/**
 * Explains what could not be found for an edition. Where an installed executable can supply the
 * answer, each offer names the program it starts before the user chooses it.
 */
function renderNotices(edition: EditionInfo, names: Map<string, string>, allowRuntimeDiscovery: boolean): HTMLElement[] {
  const pending = edition.installations.filter(installation => !edition.userDirectory || !installation.home);
  if (!pending.length) {
    return edition.reason ? [note(edition.reason, edition.reason, edition.installations.length > 0)] : [];
  }
  const allUsers = pending.some(installation => !installation.home);
  const summary = !edition.userDirectory
    ? allUsers ? 'Paths unresolved' : 'Current User path unresolved'
    : 'All Users path unresolved';
  const scopes = !edition.userDirectory ? (allUsers ? 'Current User and All Users locations' : 'Current User location') : 'All Users location';
  const explanation = [
    `Personas could not find the ${scopes} for ${edition.edition} without starting PowerShell.`,
    edition.reason ?? '',
  ].filter(Boolean).join('\n');
  const actions = allowRuntimeDiscovery ? pending.map(i => renderResolve(i, names.get(i.id))) : [];
  return [note(summary, explanation, true), ...actions];
}

function note(text: string, tooltip: string, warning: boolean): HTMLElement {
  const line = el('div', warning ? 'ps-note ps-warning' : 'ps-note');
  line.title = tooltip;
  if (warning) line.append(icon('warning'));
  line.append(el('span', 'ps-note-text', text));
  return line;
}

function renderResolve(installation: Installation, name: string | undefined): HTMLElement {
  const program = installation.executable.split(/[\\/]/).pop() || installation.executable;
  const label = el('span', 'ps-resolve-label', `Run ${program}${name ? ` (${name})` : ''} to resolve`);
  const resolve = button('ps-resolve', 'resolve', () => {
    // One start per request: the host answers with a fresh inventory whether or not it succeeds.
    resolve.disabled = true;
    label.textContent = `Running ${program}…`;
    dispatch('resolve', installation.id);
  });
  resolve.dataset.psId = installation.id;
  resolve.dataset.psNav = '';
  describe(resolve, `${label.textContent} its PowerShell profile paths`,
    `Starts ${installation.executable} once to read its PowerShell profile paths.\n`
    + 'No PowerShell profile is loaded, and the attempt stops after 5 seconds.');
  resolve.append(label);
  return resolve;
}

/** The shortest name that tells one edition's installations apart: the first path segment that differs. */
function installationNames(installations: Installation[]): Map<string, string> {
  const names = new Map<string, string>();
  if (installations.length < 2) return names;
  const locations = installations.map(installation => installation.home ?? installation.executable);
  const segments = locations.map(location => location.split(/[\\/]+/).filter(Boolean));
  const index = segments[0]?.findIndex((segment, position) => segments.some(other => other[position] !== segment)) ?? -1;
  const short = segments.map(parts => parts[index]);
  const distinct = short.every((name, position) => name && short.indexOf(name) === position);
  installations.forEach((installation, position) => {
    names.set(installation.id, (distinct ? short[position] : undefined) ?? locations[position] ?? installation.id);
  });
  return names;
}

const stateLabels = { existing: '', missing: '', unresolved: 'Unresolved', inaccessible: 'Unavailable', brokenLink: 'Broken link' };
const stateIcons: Record<ProfileRow['state'], IconName> = {
  existing: 'script', missing: 'add', unresolved: 'unknown', inaccessible: 'warning', brokenLink: 'warning',
};

function renderRow(row: ProfileRow, installationName: string | undefined): HTMLElement {
  const item = el('li', 'ps-row');
  item.dataset.psRow = row.id;
  item.dataset.psState = row.state;
  const creatable = row.state === 'missing' && !row.readOnly;
  // The installation leads, so that it is the part that survives truncation in a narrow sidebar.
  const scope = installationName ? `${installationName} · ${row.scope}` : row.scope;
  const what = `the ${row.host} PowerShell profile (${scope}, ${row.edition})`;
  const status = row.state === 'missing' ? (row.readOnly ? 'Not created; this location is read-only' : '') : stateLabels[row.state];

  const open = button('ps-open', 'open', () => dispatch('open', row.id));
  open.dataset.psNav = '';
  open.disabled = !(row.state === 'existing' || creatable);
  open.setAttribute('aria-label', open.disabled ? `${status}: ${what}` : `${creatable ? 'Create and open' : 'Open'} ${what}`);
  open.append(
    icon(row.state === 'missing' && row.readOnly ? 'lock' : stateIcons[row.state]),
    el('span', 'ps-label', row.host),
    el('span', 'ps-description', scope),
  );
  const tags = [
    stateLabels[row.state],
    row.target && row.state !== 'brokenLink' ? 'Link' : '',
    row.readOnly ? 'Read-only' : '',
  ].filter(Boolean);
  if (tags.length) open.append(el('span', 'ps-tag', tags.join(' · ')));
  item.title = rowTooltip(row, open.disabled ? status : creatable ? 'Create and open this PowerShell profile' : 'Open this PowerShell profile');
  item.append(open);
  if (!row.path) {
    item.classList.add('ps-inert');
    return item;
  }

  const more = button('ps-more', 'menu', () => (isMenuOpen(item) ? closeMenu(item) : openMenu(item, true)));
  describe(more, `More actions for ${what}`, 'More Actions…');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.append(icon('more'));
  const menu = el('div', 'ps-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `Actions for ${what}`);
  menu.hidden = true;
  menu.title = ''; // The row's tooltip describes the script, not the commands in its menu.
  const menuItem = (label: string, action: Action): HTMLButtonElement => {
    const result = button('ps-menu-item', action, () => {
      // Hand focus back to the row before the menu disappears, so the next redraw can keep it there.
      more.focus({ preventScroll: true });
      closeMenu(item);
      dispatch(action, row.id);
    });
    result.textContent = label;
    result.setAttribute('role', 'menuitem');
    return result;
  };
  menu.append(menuItem('Copy Path', 'copy'), menuItem('Reveal in File Manager', 'reveal'));
  if ((row.state === 'existing' || row.state === 'brokenLink') && !row.readOnly) {
    const remove = menuItem('Delete PowerShell Profile…', 'delete');
    // Link-only Trash behavior is not guaranteed by VS Code's public API.
    if (row.target) {
      remove.disabled = true;
      remove.title = 'Recoverable link-only deletion is unavailable; use Reveal in File Manager.';
    }
    menu.append(el('hr', 'ps-menu-separator'), remove);
  }
  // Keep focus where it is when a disabled item or the menu's padding is pressed.
  menu.addEventListener('mousedown', event => event.preventDefault());
  item.append(more, menu);

  item.addEventListener('contextmenu', event => { event.preventDefault(); openMenu(item, true); });
  item.addEventListener('focusout', event => {
    if (!(event.relatedTarget instanceof Node && item.contains(event.relatedTarget))) closeMenu(item);
  });
  item.addEventListener('keydown', event => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      openMenu(item, true);
    } else if (isMenuOpen(item)) {
      menuKey(item, event);
    }
  });
  return item;
}

function rowTooltip(row: ProfileRow, lead: string): string {
  const standard = (row.scope === 'Current User' ? 'CurrentUser' : 'AllUsers') + (row.host === 'All Hosts' ? 'AllHosts' : 'CurrentHost');
  const position = (row.scope === 'Current User' ? 2 : 0) + (row.host === 'All Hosts' ? 1 : 2);
  return [
    lead,
    `${row.edition}: ${row.scope}, ${row.host} ($PROFILE.${standard})`,
    row.path ?? 'Path unresolved',
    row.installation ? `Installation: ${row.installation}` : '',
    row.target ? `Link target: ${row.target}` : '',
    row.detail ?? '',
    row.readOnly ? 'This location is read-only; PowerShell profiles here cannot be created or changed.' : '',
    row.host === 'VS Code' ? "Loaded by the PowerShell extension's session, not by an ordinary terminal." : '',
    `Load order: ${position} of 4 in ${row.host === 'All Hosts' ? 'every host' : `the ${row.host} host`}.`,
  ].filter(Boolean).join('\n');
}

// --- Row menus ---

const menuOf = (item: Element) => item.querySelector<HTMLElement>('.ps-menu');
const moreOf = (item: Element) => item.querySelector<HTMLElement>('.ps-more');
const isMenuOpen = (item: Element): boolean => item.classList.contains('ps-menu-open');
const menuItems = (item: Element): HTMLElement[] => Array.from(item.querySelectorAll<HTMLElement>('.ps-menu-item:not(:disabled)'));

function openMenu(item: HTMLElement, focusFirst: boolean): void {
  const menu = menuOf(item);
  if (!menu) return;
  for (const other of document.querySelectorAll('.ps-menu-open')) if (other !== item) closeMenu(other);
  item.classList.add('ps-menu-open');
  moreOf(item)?.setAttribute('aria-expanded', 'true');
  menu.hidden = false;
  // Open upward when the menu would run past the bottom of the view and there is room above the row.
  menu.classList.remove('ps-menu-up');
  const overflow = menu.getBoundingClientRect().bottom > document.documentElement.clientHeight;
  menu.classList.toggle('ps-menu-up', overflow && item.getBoundingClientRect().top >= menu.offsetHeight);
  if (focusFirst) menuItems(item)[0]?.focus({ preventScroll: true });
}

function closeMenu(item: Element): void {
  item.classList.remove('ps-menu-open');
  moreOf(item)?.setAttribute('aria-expanded', 'false');
  const menu = menuOf(item);
  if (menu) menu.hidden = true;
}

function menuKey(item: HTMLElement, event: KeyboardEvent): void {
  const items = menuItems(item);
  const current = items.indexOf(document.activeElement as HTMLElement);
  const moves: Record<string, number> = {
    ArrowDown: (current + 1) % items.length, ArrowUp: (current - 1 + items.length) % items.length,
    Home: 0, End: items.length - 1,
  };
  if (event.key === 'Escape') {
    moreOf(item)?.focus({ preventScroll: true });
    closeMenu(item);
  } else if (event.key in moves && items.length) {
    items[moves[event.key] ?? 0]?.focus({ preventScroll: true });
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

// --- Section-wide input ---

let listeningToDocument = false;
const listeningRoots = new WeakSet<HTMLElement>();

function listenOnce(root: HTMLElement): void {
  if (!listeningToDocument) {
    listeningToDocument = true;
    // A press anywhere outside an open menu and its button dismisses that menu.
    document.addEventListener('pointerdown', event => {
      for (const item of document.querySelectorAll('.ps-menu-open')) {
        const inside = event.target instanceof Node
          && (menuOf(item)?.contains(event.target) || moreOf(item)?.contains(event.target));
        if (!inside) closeMenu(item);
      }
    });
  }
  if (listeningRoots.has(root)) return;
  listeningRoots.add(root);
  // Arrow keys walk the rows as they do in a list; Left and Right fold and unfold a collapsed line.
  root.addEventListener('keydown', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !('psNav' in target.dataset)) return;
    if (target.dataset.psAction === 'fold' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      setFold(target, event.key === 'ArrowRight');
      event.preventDefault();
      return;
    }
    const stops = controls(root).filter(control => 'psNav' in control.dataset);
    const current = stops.indexOf(target);
    const moves: Record<string, HTMLElement | undefined> = {
      ArrowDown: stops[current + 1], ArrowUp: stops[current - 1], Home: stops[0], End: stops.at(-1),
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    moves[event.key]?.focus();
  });
}

/** Controls a user can reach right now: enabled, and not inside a collapsed list or a closed menu. */
function controls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled)')).filter(control => !control.closest('[hidden]'));
}

/** Carry focus, open menus, and expanded lists across a redraw; never take focus from outside the view. */
function captureInteraction(root: HTMLElement): () => void {
  const rowOf = (element: Element): string => element.closest<HTMLElement>('[data-ps-row]')?.dataset.psRow ?? '';
  const editionOf = (element: Element): string => element.closest<HTMLElement>('[data-ps-edition]')?.dataset.psEdition ?? '';
  const key = (element: HTMLElement): string =>
    JSON.stringify([editionOf(element), rowOf(element), element.dataset.psId ?? '', element.dataset.psAction]);
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && root.contains(active) ? active : undefined;
  const focusedKey = focused ? key(focused) : undefined;
  const focusedRow = focused ? rowOf(focused) : '';
  const focusedEdition = focused ? editionOf(focused) : '';
  const openMenus = new Set(Array.from(root.querySelectorAll('.ps-menu-open')).map(rowOf));
  const openFolds = new Set(Array.from(root.querySelectorAll('.ps-fold[aria-expanded="true"]')).map(editionOf));
  return () => {
    for (const fold of root.querySelectorAll<HTMLElement>('.ps-fold')) setFold(fold, openFolds.has(editionOf(fold)));
    for (const item of root.querySelectorAll<HTMLElement>('[data-ps-row]')) {
      if (openMenus.has(rowOf(item))) openMenu(item, false);
    }
    if (!focusedKey) return;
    const reachable = controls(root);
    const replacement = reachable.find(control => key(control) === focusedKey)
      ?? reachable.find(control => focusedRow && rowOf(control) === focusedRow)
      ?? reachable.find(control => focusedEdition && editionOf(control) === focusedEdition)
      ?? reachable[0];
    replacement?.focus({ preventScroll: true });
  };
}
