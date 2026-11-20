// @vitest-environment jsdom
// Drives the real Extension Matrix webview (main.ts) through host messages and checks where
// keyboard focus lands after each table rebuild.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Inventory } from '../../src/core/types';
import type { HostToMatrix, MatrixToHost } from '../../src/protocol';
import { cellAt, inv, withInherited } from './matrixDom';

const posted: MatrixToHost[] = [];

function send(message: HostToMatrix): void {
  window.dispatchEvent(new MessageEvent('message', { data: message, origin: window.location.origin }));
}

function sendInventory(inventory: Inventory): void {
  send({ type: 'inventory', inventory, icons: {} });
}

function table(): HTMLTableElement {
  const found = document.querySelector<HTMLTableElement>('.content table');
  if (!found) throw new Error('The matrix table is not rendered');
  return found;
}

function checkbox(extension: string, profile: string): HTMLInputElement {
  const box = cellAt(table(), extension, profile).querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!box) throw new Error(`${extension} in ${profile} has no checkbox`);
  return box;
}

function nameOf(extension: string): HTMLElement {
  return cellAt(table(), extension, 'Extension').querySelector<HTMLElement>('.name')!;
}

const card = () => document.querySelector<HTMLElement>('.ext-card')!;
const filterInput = () => document.querySelector<HTMLInputElement>('.toolbar input[type="search"]')!;

function press(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Opens an extension's hover card from the keyboard and Tabs into it, returning the focused action. */
function focusCardAction(extension: string): HTMLElement {
  nameOf(extension).focus();
  press(nameOf(extension), 'Tab'); // a forward Tab from the name moves into the open card
  const action = document.activeElement as HTMLElement;
  expect(card().contains(action)).toBe(true);
  return action;
}

/** The inventory with the Gamma row, after Beta is gone. */
const withoutBeta: Inventory = { ...withInherited, extensions: withInherited.extensions.filter((e) => e.id !== 'pub.b') };

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const g = globalThis as unknown as Record<string, unknown>;
  g['acquireVsCodeApi'] = () => ({ postMessage: (m: MatrixToHost) => posted.push(m) });
  if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    // jsdom has no CSS.escape; syncOpenCard uses it only for extension IDs, which need no escaping here.
    g['CSS'] = { escape: (value: string) => value };
  }
  await import('../../src/webview/main.js'); // Vite resolves the .js specifier to main.ts
});

beforeEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  filterInput().value = '';
  filterInput().dispatchEvent(new Event('input'));
  sendInventory(inv);
  posted.length = 0;
});

describe('focus through a toggle', () => {
  it('stays on the toggled cell while the change is pending and after it completes', () => {
    const box = checkbox('Beta', 'Default');
    box.focus();
    box.click();

    expect(posted).toContainEqual({ type: 'toggleCell', extId: 'pub.b', profileId: 'default', install: true });
    const pending = checkbox('Beta', 'Default');
    expect(pending).not.toBe(box); // the table was rebuilt
    expect(document.activeElement).toBe(pending);
    expect(pending.getAttribute('aria-disabled')).toBe('true');

    send({ type: 'pending', extId: 'pub.b', profileId: 'default' });
    expect(document.activeElement).toBe(checkbox('Beta', 'Default'));

    sendInventory({
      ...inv,
      extensions: inv.extensions.map((e) => (e.id === 'pub.b' ? { ...e, installedIn: ['default', 'aaa'] } : e)),
    });
    const done = checkbox('Beta', 'Default');
    expect(document.activeElement).toBe(done);
    expect(done.checked).toBe(true);
    expect(done.hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('focus through an unrelated refresh', () => {
  it('stays on the focused checkbox', () => {
    checkbox('Beta', 'Work').focus();

    sendInventory(withInherited);

    expect(document.activeElement).toBe(checkbox('Beta', 'Work'));
  });

  it('stays on a focused name without reopening a card the user closed', () => {
    nameOf('Beta').focus();
    expect(card().hidden).toBe(false); // keyboard focus opens the card
    press(nameOf('Beta'), 'Escape');
    expect(card().hidden).toBe(true);
    expect(document.activeElement).toBe(nameOf('Beta'));

    sendInventory(withInherited);

    expect(document.activeElement).toBe(nameOf('Beta'));
    expect(card().hidden).toBe(true);
  });
});

describe('focus when the focused row is removed', () => {
  it('moves to the same control in the nearest remaining row', () => {
    sendInventory(withInherited);
    checkbox('Beta', 'Work').focus();

    sendInventory(withoutBeta);

    expect(document.activeElement).toBe(checkbox('Gamma', 'Work'));
  });

  it("moves from the removed row's hover card to the nearest remaining row", () => {
    sendInventory(withInherited);
    focusCardAction('Beta');

    sendInventory(withoutBeta);

    expect(card().hidden).toBe(true);
    expect(document.activeElement).toBe(nameOf('Gamma'));
  });

  it('leaves focus in the hover card when its row survives the refresh', () => {
    const action = focusCardAction('Beta').dataset['action'];

    sendInventory(withInherited);

    expect(card().hidden).toBe(false);
    expect((document.activeElement as HTMLElement).dataset['action']).toBe(action);
  });
});

describe('focus outside the matrix', () => {
  it('is never taken by a rebuild', () => {
    const input = filterInput();
    input.focus();
    input.value = 'Be';
    input.dispatchEvent(new Event('input'));
    expect(document.activeElement).toBe(input);

    sendInventory(withInherited);
    send({ type: 'pending', extId: 'pub.b', profileId: 'default' });

    expect(document.activeElement).toBe(input);
  });
});

describe('Escape in the hover card', () => {
  it('closes the card and returns focus to the extension name that opened it', () => {
    press(focusCardAction('Beta'), 'Escape');

    expect(card().hidden).toBe(true);
    expect(document.activeElement).toBe(nameOf('Beta'));
  });
});
