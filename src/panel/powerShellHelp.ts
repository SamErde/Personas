import * as vscode from 'vscode';
import { openPowerShellSettings } from './settingsActions';

export const powerShellProfilesDocsUrl =
  'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles';

const openSettings = 'Open PowerShell Settings';
const learnMore = 'Profiles on Microsoft Learn';

/** The help text. Modal dialogs show plain text, so each question sits on its own line above its answer. */
export const powerShellHelpDetail = [
  'How are paths found?',
  'Personas checks known locations without starting PowerShell, including when you refresh.',
  '',
  'What does runtime discovery allow?',
  'If a path is unresolved, enable Allow Runtime Discovery in Personas Settings to use “Run … to resolve”. ' +
    'Each click starts the named executable once with profiles disabled. Successful results are kept for this session.',
  '',
  'Can I create a missing profile?',
  'Yes, once its location is known and writable.',
].join('\n');

/**
 * The Help button in the PowerShell Profiles title bar. A webview draws only inside its own view, so the
 * help opens as a VS Code modal dialog: larger than the sidebar, and closed with Esc or Cancel (or its X
 * where the platform shows one).
 */
export async function showPowerShellHelp(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    'PowerShell Profiles help',
    { modal: true, detail: powerShellHelpDetail },
    openSettings,
    learnMore,
  );
  if (choice === openSettings) {
    await openPowerShellSettings();
  } else if (choice === learnMore) {
    await vscode.env.openExternal(vscode.Uri.parse(powerShellProfilesDocsUrl));
  }
}
