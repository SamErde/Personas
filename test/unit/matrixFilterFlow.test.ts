// @vitest-environment jsdom
// Drives the real Extension Matrix webview (main.ts) through host messages and checks the view
// chips, the text filter, the result announcement, and the view state kept by the host.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToMatrix, MatrixToHost } from '../../src/protocol';
import { NO_FILTERS } from '../../src/webview/render';
import { inv } from './matrixDom';

const posted: MatrixToHost[] = [];

function send(message: HostToMatrix): void {
  window.dispatchEvent(new MessageEvent('message', { data: message, origin: window.location.origin }));
}

const filterInput = () => document.querySelector<HTMLInputElement>('.toolbar input[type="search"]')!;
const announcement = () => document.querySelector<HTMLElement>('[aria-live="polite"]')!.textContent;
const shownNames = () => [...document.querySelectorAll<HTMLElement>('.content tbody .name')].map((name) => name.textContent);

function viewChip(label: string): HTMLButtonElement {
  const chip = [...document.querySelectorAll<HTMLButtonElement>('.toolbar button')].find((b) => b.textContent === label);
  if (!chip) throw new Error(`No view chip labelled ${label}`);
  return chip;
}

function type(text: string): void {
  filterInput().value = text;
  filterInput().dispatchEvent(new Event('input'));
}

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const g = globalThis as unknown as Record<string, unknown>;
  g['acquireVsCodeApi'] = () => ({ postMessage: (m: MatrixToHost) => posted.push(m) });
  if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') g['CSS'] = { escape: (value: string) => value };
  await import('../../src/webview/main.js'); // Vite resolves the .js specifier to main.ts
});

beforeEach(() => {
  vi.useFakeTimers();
  send({ type: 'viewState', state: { filters: NO_FILTERS } });
  send({ type: 'inventory', inventory: inv, icons: {} });
  posted.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('view chips', () => {
  it('tell assistive technology which view is selected', () => {
    expect(viewChip('All').getAttribute('aria-pressed')).toBe('true');
    expect(viewChip('Orphaned').getAttribute('aria-pressed')).toBe('false');

    viewChip('Applied to all profiles').click();

    expect(viewChip('All').getAttribute('aria-pressed')).toBe('false');
    expect(viewChip('Applied to all profiles').getAttribute('aria-pressed')).toBe('true');
    expect(shownNames()).toEqual(['Alpha']);
  });
});

describe('text filter', () => {
  it('applies after a short pause in typing', () => {
    type('Be');
    expect(shownNames()).toEqual(['Alpha', 'Beta']);

    vi.advanceTimersByTime(300);

    expect(shownNames()).toEqual(['Beta']);
  });
});

describe('result announcement', () => {
  it('announces how many extensions are shown after a filter change', () => {
    viewChip('Applied to all profiles').click();
    expect(announcement()).toBe('1 of 2 extensions');

    type('zzz');
    vi.advanceTimersByTime(300);
    expect(announcement()).toBe('0 of 2 extensions');
  });

  it('stays quiet when the host refreshes the list', () => {
    viewChip('Orphaned').click();
    viewChip('All').click();
    const before = announcement();

    send({ type: 'inventory', inventory: { ...inv, extensions: inv.extensions.slice(0, 1) }, icons: {} });

    expect(announcement()).toBe(before);
  });
});

describe('view state kept by the host', () => {
  it('is sent to the host when the view or the text filter changes', () => {
    viewChip('Orphaned').click();
    type('Be');
    vi.advanceTimersByTime(300);

    expect(posted).toEqual([
      { type: 'viewState', state: { filters: { ...NO_FILTERS, view: 'orphaned' } } },
      { type: 'viewState', state: { filters: { ...NO_FILTERS, view: 'orphaned', text: 'Be' } } },
    ]);
  });

  it('is restored from the host into the chips, the filter box, and the table', () => {
    send({ type: 'viewState', state: { filters: { ...NO_FILTERS, view: 'appliedToAllProfiles', text: 'Al' } } });

    expect(filterInput().value).toBe('Al');
    expect(viewChip('Applied to all profiles').getAttribute('aria-pressed')).toBe('true');
    expect(shownNames()).toEqual(['Alpha']);
    expect(posted).toEqual([]);
  });
});
