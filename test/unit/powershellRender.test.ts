// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { buildProfileLocations, type EditionInfo, type PowerShellInventory, type ProfileRow } from '../../src/powershell/profiles';
import { powerShellProfilesBody } from '../../src/panel/powerShellProfilesMarkup';
import type { PowerShellAction } from '../../src/protocol';
import { renderPowerShell } from '../../src/webview/powershell';

/** The view's real markup, so that this test cannot drift from it. */
const markup = `${powerShellProfilesBody}<button id="outside">Outside</button>`;

const user = '/home/me/.config/powershell';
const home = '/opt/microsoft/powershell/7';
const edition: EditionInfo = {
  edition: 'PowerShell 7', userDirectory: user, installations: [{ id: home, executable: `${home}/pwsh`, home }],
};

/** Every location starts missing; `states` overrides rows by "scope/host". */
function inventory(states: Record<string, Partial<ProfileRow>> = {}, editions: EditionInfo[] = [edition]): PowerShellInventory {
  const rows = buildProfileLocations('linux', editions).map((location): ProfileRow => ({
    ...location,
    state: location.path ? 'missing' : 'unresolved',
    ...states[`${location.scope}/${location.host}`],
  }));
  return { editions, rows };
}
const console7 = { 'Current User/Console': { state: 'existing' } } as const;

let sent: PowerShellAction[];
const render = (data: PowerShellInventory) => renderPowerShell(data, message => sent.push(message));
const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`No element matches ${selector}`);
  return found;
};
const all = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector));
const rowFor = (scopeAndHost: string) => {
  const found = all('.ps-row').find(row => {
    const [, scope, , host] = JSON.parse(row.dataset.psRow ?? '[]') as string[];
    return `${scope}/${host}` === scopeAndHost;
  });
  if (!found) throw new Error(`No row for ${scopeAndHost}`);
  return found;
};
const visible = (element: Element) => !element.closest('[hidden]');
const menuItem = (row: HTMLElement, action: string) => row.querySelector<HTMLButtonElement>(`.ps-menu-item[data-ps-action="${action}"]`);
const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

beforeEach(() => {
  document.body.innerHTML = markup;
  sent = [];
});

describe('automatic refresh', () => {
  it('keeps an open row menu and its focused action', () => {
    render(inventory(console7));
    rowFor('Current User/Console').querySelector<HTMLElement>('.ps-more')!.click();
    menuItem(rowFor('Current User/Console'), 'reveal')!.focus();

    render(inventory(console7));

    const row = rowFor('Current User/Console');
    expect(row.querySelector<HTMLElement>('.ps-menu')!.hidden).toBe(false);
    expect(row.querySelector('.ps-more')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Reveal in File Manager');
  });

  it('keeps the focused row focused but never steals focus from outside the view', () => {
    render(inventory(console7));
    rowFor('Current User/Console').querySelector<HTMLElement>('.ps-open')!.focus();

    render(inventory(console7));
    expect(document.activeElement).toBe(rowFor('Current User/Console').querySelector('.ps-open'));

    one('#outside').focus();
    render(inventory(console7));
    expect(document.activeElement?.id).toBe('outside');
  });

  it('keeps a collapsed line expanded and follows the focused row when its state changes', () => {
    render(inventory(console7));
    one('.ps-fold').click();
    rowFor('Current User/VS Code').querySelector<HTMLElement>('.ps-open')!.focus();

    // The focused location gains a script, so its row moves out of the collapsed line.
    render(inventory({ ...console7, 'Current User/VS Code': { state: 'existing' } }));

    expect(one('.ps-fold').getAttribute('aria-expanded')).toBe('true');
    expect(one('.ps-folded').hidden).toBe(false);
    expect(document.activeElement).toBe(rowFor('Current User/VS Code').querySelector('.ps-open'));
  });

  it('moves focus to a neighbor when the focused control disappears', () => {
    const unresolved: EditionInfo = { ...edition, installations: [{ id: `${home}/pwsh`, executable: `${home}/pwsh` }] };
    render(inventory(console7, [unresolved]));
    one('.ps-resolve').focus();

    render(inventory(console7));

    expect(document.activeElement).toBe(rowFor('Current User/Console').querySelector('.ps-open'));
  });
});

describe('rows', () => {
  it('shows existing PowerShell profiles and folds the missing ones into one collapsed line', () => {
    render(inventory({ ...console7, 'Current User/VS Code': { state: 'existing' } }));

    expect(all('.ps-row').filter(visible).map(row => row.dataset.psState)).toEqual(['existing', 'existing']);
    expect(one('.ps-fold').textContent).toBe('4 not created');
    expect(one('.ps-fold').getAttribute('aria-expanded')).toBe('false');
    expect(all('.ps-folded .ps-row')).toHaveLength(4);

    one('.ps-fold').click();
    expect(all('.ps-row').filter(visible)).toHaveLength(6);
  });

  it('labels each row with its host and scope and lists rows in load order', () => {
    render(inventory({ 'All Users/All Hosts': { state: 'existing' }, ...console7, 'Current User/All Hosts': { state: 'existing' } }));

    const labels = all('.ps-row').filter(visible).map(row =>
      `${row.querySelector('.ps-label')!.textContent} / ${row.querySelector('.ps-description')!.textContent}`);
    expect(labels).toEqual(['All Hosts / All Users', 'All Hosts / Current User', 'Console / Current User']);
    expect(rowFor('Current User/Console').title).toContain(`${user}/Microsoft.PowerShell_profile.ps1`);
    expect(rowFor('Current User/Console').title).toContain('Load order: 4 of 4 in the Console host.');
    expect(rowFor('All Users/All Hosts').title).toContain('Load order: 1 of 4 in every host.');
  });

  it('opens an existing script, or asks to create a missing one, with a single control per row', () => {
    render(inventory(console7));
    const existing = rowFor('Current User/Console');
    const missing = rowFor('Current User/All Hosts');

    expect(existing.querySelectorAll('[data-ps-action="open"]')).toHaveLength(1);
    expect(existing.querySelector('.ps-open')!.getAttribute('aria-label')).toMatch(/^Open the Console PowerShell profile/);
    expect(missing.querySelector('.ps-open')!.getAttribute('aria-label')).toMatch(/^Create and open the All Hosts PowerShell profile/);
    existing.querySelector<HTMLElement>('.ps-open')!.click();
    missing.querySelector<HTMLElement>('.ps-open')!.click();

    expect(sent).toEqual([
      { type: 'powerShellAction', action: 'open', id: existing.dataset.psRow },
      { type: 'powerShellAction', action: 'open', id: missing.dataset.psRow },
    ]);
  });

  it('represents every state without offering an action that cannot work', () => {
    render(inventory({
      'Current User/All Hosts': { state: 'brokenLink', target: '/dotfiles/profile.ps1' },
      'Current User/Console': { state: 'existing', target: '/dotfiles/console.ps1' },
      'Current User/VS Code': { state: 'inaccessible', detail: 'EACCES' },
      'All Users/All Hosts': { state: 'existing', readOnly: true },
      'All Users/Console': { state: 'missing', readOnly: true },
      'All Users/VS Code': { state: 'unresolved', path: undefined, detail: 'Profile directory unresolved' },
    }));
    const tag = (key: string) => rowFor(key).querySelector('.ps-tag')?.textContent ?? '';
    const openable = (key: string) => !rowFor(key).querySelector<HTMLButtonElement>('.ps-open')!.disabled;

    expect(tag('Current User/All Hosts')).toBe('Broken link');
    expect(tag('Current User/Console')).toBe('Link');
    expect(tag('Current User/VS Code')).toBe('Unavailable');
    expect(tag('All Users/All Hosts')).toBe('Read-only');
    expect(tag('All Users/Console')).toBe('Read-only');
    expect(tag('All Users/VS Code')).toBe('Unresolved');
    expect(one('.ps-fold').textContent).toBe('1 not created · 1 unresolved');
    expect(['Current User/Console', 'All Users/All Hosts'].every(openable)).toBe(true);
    expect(['Current User/All Hosts', 'Current User/VS Code', 'All Users/Console', 'All Users/VS Code'].some(openable)).toBe(false);
    expect(rowFor('Current User/Console').title).toContain('Link target: /dotfiles/console.ps1');
    expect(rowFor('Current User/VS Code').title).toContain('EACCES');

    // Deleting is withheld from read-only locations and disabled for links; an unresolved path has no menu at all.
    expect(menuItem(rowFor('Current User/Console'), 'delete')!.disabled).toBe(true);
    expect(menuItem(rowFor('Current User/All Hosts'), 'delete')!.disabled).toBe(true);
    expect(menuItem(rowFor('All Users/All Hosts'), 'delete')).toBeNull();
    expect(menuItem(rowFor('All Users/Console'), 'copy')).not.toBeNull();
    expect(rowFor('All Users/VS Code').querySelector('.ps-more')).toBeNull();
  });
});

describe('row menu', () => {
  it('sends copy, reveal, and delete for the row and closes afterwards', () => {
    render(inventory(console7));
    const row = rowFor('Current User/Console');
    for (const action of ['copy', 'reveal', 'delete']) {
      row.querySelector<HTMLElement>('.ps-more')!.click();
      expect(row.querySelector<HTMLElement>('.ps-menu')!.hidden).toBe(false);
      menuItem(row, action)!.click();
      expect(row.querySelector<HTMLElement>('.ps-menu')!.hidden).toBe(true);
    }

    expect(sent.map(message => message.type === 'powerShellAction' && [message.action, message.id])).toEqual(
      ['copy', 'reveal', 'delete'].map(action => [action, row.dataset.psRow]));
    expect(document.activeElement).toBe(row.querySelector('.ps-more'));
  });

  it('opens from the keyboard, walks its items with the arrow keys, and returns focus on Escape', () => {
    render(inventory(console7));
    const row = rowFor('Current User/Console');
    const open = row.querySelector<HTMLElement>('.ps-open')!;
    open.focus();

    press(open, 'F10', { shiftKey: true });
    expect(document.activeElement).toBe(menuItem(row, 'copy'));
    press(document.activeElement!, 'ArrowUp');
    expect(document.activeElement).toBe(menuItem(row, 'delete'));

    press(document.activeElement!, 'Escape');
    expect(row.querySelector<HTMLElement>('.ps-menu')!.hidden).toBe(true);
    expect(document.activeElement).toBe(row.querySelector('.ps-more'));
  });

  it('closes when something outside it is pressed, and keeps only one menu open', () => {
    render(inventory({ ...console7, 'Current User/VS Code': { state: 'existing' } }));
    const first = rowFor('Current User/Console');
    const second = rowFor('Current User/VS Code');

    first.querySelector<HTMLElement>('.ps-more')!.click();
    second.querySelector<HTMLElement>('.ps-more')!.click();
    expect(all('.ps-menu').filter(menu => !menu.hidden)).toEqual([second.querySelector('.ps-menu')]);

    one('#outside').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(all('.ps-menu').filter(menu => !menu.hidden)).toEqual([]);
  });
});

describe('section actions', () => {
  it('offers to resolve only where a location is unresolved, and names the program it will start', () => {
    render(inventory(console7));
    expect(all('.ps-resolve')).toHaveLength(0);

    const unresolved: EditionInfo = { ...edition, installations: [{ id: `${home}/pwsh`, executable: `${home}/pwsh` }] };
    render(inventory(console7, [unresolved]));
    const resolve = one<HTMLButtonElement>('.ps-resolve');

    expect(one('.ps-note').textContent).toBe('All Users path unresolved');
    expect(resolve.textContent).toBe('Run pwsh to resolve');
    expect(resolve.title).toContain(`Starts ${home}/pwsh once`);
    resolve.click();
    expect(sent).toEqual([{ type: 'powerShellAction', action: 'resolve', id: `${home}/pwsh` }]);
    expect(resolve.disabled).toBe(true);
  });

  it('tells two installations apart by the first path segment that differs', () => {
    const second = '/usr/local/microsoft/powershell/7';
    const two: EditionInfo = {
      ...edition, userDirectory: undefined,
      installations: [{ id: home, executable: `${home}/pwsh`, home }, { id: second, executable: `${second}/pwsh`, home: second }],
    };
    render(inventory({}, [two]));

    expect(one('.ps-note').textContent).toBe('Current User path unresolved');
    expect(all('.ps-resolve').map(resolve => resolve.textContent)).toEqual(['Run pwsh (opt) to resolve', 'Run pwsh (usr) to resolve']);
    expect(all('.ps-folded .ps-description').map(description => description.textContent)).toContain('usr · All Users');
  });

  it('renders the error for remote windows in place of the list', () => {
    render({ editions: [], rows: [], error: 'PowerShell profiles support local desktop windows. WSL support is planned next.' });

    expect(one('#powershell').textContent).toBe('PowerShell profiles support local desktop windows. WSL support is planned next.');
    expect(all('.ps-row')).toHaveLength(0);
  });
});
