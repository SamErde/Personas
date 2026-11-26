import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  openPersonasSettings,
  openPowerShellSettings,
  personasSettingsQuery,
  powerShellSettingsQuery,
} from '../../src/panel/settingsActions';
import type * as Doubles from './sidebarDoubles';
import { resetSidebarDoubles, vscodeState } from './sidebarDoubles';

vi.mock('vscode', async () => (await vi.importActual<typeof Doubles>('./sidebarDoubles')).vscodeDouble());

afterEach(resetSidebarDoubles);

const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
const settings: Record<string, { scope?: string }> = manifest.contributes.configuration.properties;

// VS Code opens the graphical editor on the User tab only through workbench.action.openSettings with a
// query: workbench.action.openGlobalSettings follows `workbench.settings.editor: json` and drops the
// query. The mocks record command arguments only, so these tests pin the command and its query; the
// Settings editor itself was checked in an Extension Development Host (PR #161).
it('opens Personas settings from the Home gear with a query, so Settings opens graphical on the User tab', async () => {
  await openPersonasSettings();
  expect(vscodeState.commands).toEqual(['workbench.action.openSettings']);
  expect(vscodeState.commandArgs).toEqual([['@ext:SamErde.personas']]);
});

it('opens the PowerShell Profiles settings the same way', async () => {
  await openPowerShellSettings();
  expect(vscodeState.commands).toEqual(['workbench.action.openSettings']);
  expect(vscodeState.commandArgs).toEqual([[powerShellSettingsQuery]]);
  expect(powerShellSettingsQuery.startsWith(personasSettingsQuery + ' ')).toBe(true);
});

it('filters to exactly the PowerShell Profiles settings, including machine-scoped Allow Runtime Discovery', () => {
  const fragment = powerShellSettingsQuery.slice(personasSettingsQuery.length + 1).toLowerCase();
  const ids = Object.keys(settings);
  const matched = ids.filter((id) => id.toLowerCase().includes(fragment));
  expect(matched).toEqual(ids.filter((id) => id.startsWith('personas.powerShellProfiles.')));
  expect(matched).toContain('personas.powerShellProfiles.allowRuntimeDiscovery');
  // Machine scope is why the Workspace tab hides it, and why the User tab matters.
  expect(settings['personas.powerShellProfiles.allowRuntimeDiscovery']!.scope).toBe('machine');
});
