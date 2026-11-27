import * as vscode from 'vscode';
import { openPowerShellSettings } from './settingsActions';

export const powerShellProfilesDocsUrl =
  'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles';

const openSettings = 'Open PowerShell Settings';
const learnMore = 'Profiles on Microsoft Learn';

/** The help text. Modal dialogs show plain text, so each question sits on its own line above its answer. */
export const powerShellHelpDetail = [
  'How are paths found?',
  'Personas finds installations without starting PowerShell, then asks each detected edition for its canonical profile paths in the background. Profiles stay disabled during the probe.',
  '',
  'What does runtime discovery allow?',
  'Allow Runtime Discovery is on by default. Turn it off to use only passive discovery and the Windows registry fallback. ' +
    'If an automatic attempt fails, “Run … to resolve” retries the named executable once. Results are kept for this session.',
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
