import { afterEach, expect, it, vi } from 'vitest';
import { powerShellHelpDetail, powerShellProfilesDocsUrl, showPowerShellHelp } from '../../src/panel/powerShellHelp';
import { powerShellSettingsQuery } from '../../src/panel/settingsActions';
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
  // The query is what makes VS Code open the graphical editor on the User tab (see settingsActions.ts).
  expect(vscodeState.commands).toEqual(['workbench.action.openSettings']);
  expect(vscodeState.commandArgs).toEqual([[powerShellSettingsQuery]]);
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
