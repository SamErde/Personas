// @vitest-environment jsdom
// Drives the real Extension Matrix webview (main.ts) through host messages and checks the Legend
// disclosure in the toolbar and the order of the toolbar's controls.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceInventory } from '../../src/core/types';
import type { MatrixToHost } from '../../src/protocol';
import { NO_FILTERS } from '../../src/webview/render';
import { inv, loadMatrixWebview, sendToMatrix as send } from './matrixDom';

const posted: MatrixToHost[] = [];

const legendButton = () => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.toolbar button')].find((b) => b.textContent === 'Legend');
  if (!button) throw new Error('No Legend button in the toolbar');
  return button;
};
const legendPanel = () => document.getElementById(legendButton().getAttribute('aria-controls') ?? '')!;

beforeAll(() => loadMatrixWebview(posted));

beforeEach(() => {
  send({ type: 'cleanupResult', results: [] });
  send({ type: 'viewState', state: { filters: NO_FILTERS, groupBy: 'none' } });
  send({ type: 'inventory', inventory: inv, icons: {} });
  if (legendButton().getAttribute('aria-expanded') === 'true') legendButton().click();
});

describe('the Legend disclosure', () => {
  it('starts closed, and opens and closes its panel', () => {
    expect(legendButton().getAttribute('aria-expanded')).toBe('false');
    expect(legendPanel().hidden).toBe(true);

    legendButton().click();
    expect(legendButton().getAttribute('aria-expanded')).toBe('true');
    expect(legendPanel().hidden).toBe(false);

    legendButton().click();
    expect(legendButton().getAttribute('aria-expanded')).toBe('false');
    expect(legendPanel().hidden).toBe(true);
  });

  it('holds the cell legend, which no longer sits between the toolbar and the table', () => {
    const cells = legendPanel().querySelector('[aria-label="Extension Matrix cell legend"]');
    expect([...(cells?.querySelectorAll('li') ?? [])].map((li) => li.textContent?.trim())).toEqual([
      '◆ Applied to all profiles',
      '⤷ Installed through Default',
      "✓ Installed, can't change here",
      '— Not installed',
      '? Unknown, list could not be read',
    ]);
    expect(document.querySelector('.content [aria-label$="legend"]')).toBeNull();
  });

  it('adds the Current workspace legend only while a workspace is open', () => {
    const workspaceLegend = () => legendPanel().querySelector<HTMLElement>('[aria-label="Current workspace extension status legend"]');
    const shown = () => {
      const legend = workspaceLegend();
      return legend !== null && legend.closest('[hidden]') === null;
    };
    legendButton().click();
    expect(shown()).toBe(false);

    send({ type: 'inventory', inventory: inv, workspace: openFolder, icons: {} });
    expect(shown()).toBe(true);
    expect([...workspaceLegend()!.children].map((item) => item.textContent?.trim())).toEqual([
      '✓ Enabled',
      '○ Not enabled',
      '— Not installed in profile',
      '✓ W Workspace-local',
      '? Unknown',
    ]);
    expect(document.querySelector('.content [aria-label$="legend"]')).toBeNull();

    send({ type: 'inventory', inventory: inv, icons: {} });
    expect(shown()).toBe(false);
  });

  it('stays open while the host refreshes the matrix', () => {
    legendButton().click();
    send({ type: 'inventory', inventory: inv, icons: {} });
    expect(legendButton().getAttribute('aria-expanded')).toBe('true');
    expect(legendPanel().hidden).toBe(false);
  });
});

describe('the toolbar', () => {
  it('reaches its controls in order: filter box, views, Filters, Group by, orphans, Legend, Refresh', () => {
    const orphan = { id: 'pub.o', displayName: 'Old', versions: [], applyToAllProfiles: false, installedIn: [], orphaned: true };
    send({ type: 'inventory', inventory: { ...inv, extensions: [...inv.extensions, orphan] }, icons: {} });

    const controls = [...document.querySelectorAll<HTMLElement>('.toolbar input, .toolbar select, .toolbar button')].filter(
      (control) => !control.hidden && control.tabIndex >= 0,
    );
    expect(controls.map((control) => control.getAttribute('aria-label') ?? (control instanceof HTMLSelectElement ? 'Group by' : control.textContent))).toEqual([
      'Filter extensions by name, ID, or publisher',
      'All',
      'Applied to all profiles',
      'Filters',
      'Group by',
      'Review 1 orphaned…',
      'Legend',
      '↻ Refresh',
    ]);
  });
});

/** An open folder named Repo whose active profile is Work. */
const openFolder: WorkspaceInventory = {
  descriptor: { name: 'Repo', kind: 'folder', rootFsPaths: ['/repo'] },
  activeProfileId: 'aaa',
  activeProfileName: 'Work',
  extensions: [],
  warnings: [],
};
