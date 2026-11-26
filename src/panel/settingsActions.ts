import * as vscode from 'vscode';

/**
 * The command behind Personas' settings actions. Given a query, VS Code opens the graphical Settings
 * editor on the User tab: `PreferencesService.openSettings` sets the User target and turns off the
 * JSON editor. That holds even with `workbench.settings.editor` set to `json`, or with Settings last
 * left on the Workspace tab, where machine-scoped settings such as Allow Runtime Discovery are hidden.
 * `workbench.action.openGlobalSettings` does neither: it follows the JSON preference, which drops the
 * query, and its argument sanitizer strips `jsonEditor`. Checked against VS Code 1.101.0.
 */
export const openSettingsCommand = 'workbench.action.openSettings';

/** Every Personas setting. */
export const personasSettingsQuery = '@ext:SamErde.personas';
/** Personas' settings whose IDs name PowerShell Profiles. */
export const powerShellSettingsQuery = `${personasSettingsQuery} powerShellProfiles`;

/** The gear in each Home view's title bar, and Personas: Open Personas Settings. */
export async function openPersonasSettings(): Promise<void> {
  await vscode.commands.executeCommand(openSettingsCommand, personasSettingsQuery);
}

/** Open PowerShell Settings, in the PowerShell Profiles help. */
export async function openPowerShellSettings(): Promise<void> {
  await vscode.commands.executeCommand(openSettingsCommand, powerShellSettingsQuery);
}
