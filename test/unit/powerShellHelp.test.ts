import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  powerShellHelpDetail,
  powerShellProfilesDocsUrl,
  powerShellSettingsQuery,
  showPowerShellHelp,
} from '../../src/panel/powerShellHelp';
import type * as Doubles from './sidebarDoubles';
import { resetSidebarDoubles, vscodeState } from './sidebarDoubles';

vi.mock('vscode', async () => (await vi.importActual<typeof Doubles>('./sidebarDoubles')).vscodeDouble());

afterEach(resetSidebarDoubles);

it('shows the help as a modal dialog with every question and both buttons', async () => {
  await showPowerShellHelp();
  expect(vscodeState.informationMessages).toHaveLength(1);
  const shown = vscodeState.informationMessages[0]!;
  expect(shown.message).toBe('PowerShell Profiles help');
  expect(shown.options).toEqual({ modal: true, detail: powerShellHelpDetail });
  for (const question of ['How are paths found?', 'What does runtime discovery allow?', 'Can I create a missing profile?']) {
    expect(powerShellHelpDetail).toContain(question + '\n');
  }
  expect(shown.items).toEqual(expect.arrayContaining(['Open PowerShell Settings', 'Profiles on Microsoft Learn']));
  expect(shown.items).toHaveLength(2);
});

it('opens User Settings filtered to the PowerShell Profiles settings', async () => {
  vscodeState.informationChoice = 'Open PowerShell Settings';
  await showPowerShellHelp();
  expect(vscodeState.commands).toEqual(['workbench.action.openGlobalSettings']);
  expect(vscodeState.commandArgs).toEqual([[{ query: powerShellSettingsQuery }]]);
  expect(vscodeState.opened).toEqual([]);
});

it('opens the Microsoft Learn page about profiles', async () => {
  vscodeState.informationChoice = 'Profiles on Microsoft Learn';
  await showPowerShellHelp();
  expect(vscodeState.opened).toEqual([powerShellProfilesDocsUrl]);
  expect(vscodeState.commands).toEqual([]);
});

it('does nothing when the dialog is dismissed', async () => {
  await showPowerShellHelp();
  expect(vscodeState.commands).toEqual([]);
  expect(vscodeState.opened).toEqual([]);
});

it('filters Settings by an ID fragment every PowerShell Profiles setting shares', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
  const fragment = powerShellSettingsQuery.replace('@ext:SamErde.personas ', '');
  const ids = Object.keys(manifest.contributes.configuration.properties);
  const matched = ids.filter((id) => id.toLowerCase().includes(fragment.toLowerCase()));
  expect(matched).toEqual(ids.filter((id) => id.startsWith('personas.powerShellProfiles.')));
  expect(matched.length).toBeGreaterThan(0);
});
