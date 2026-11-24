/** A setting's values as `WorkspaceConfiguration.inspect` reports them: only what the user set, per scope. */
export type InspectedSetting =
  | { defaultValue?: boolean; globalValue?: boolean; workspaceValue?: boolean; workspaceFolderValue?: boolean }
  | undefined;

export const OPEN_WITH_SIDEBAR_SETTING = 'extensionMatrix.openWithSidebar';
/** The setting's name before it was renamed. Still read, so a user who turned it off keeps that choice. */
export const LEGACY_OPEN_WITH_SIDEBAR_SETTING = 'openMatrixOnActivityBarClick';

function userValue(setting: InspectedSetting): boolean | undefined {
  return setting?.workspaceFolderValue ?? setting?.workspaceValue ?? setting?.globalValue;
}

/**
 * Whether showing the VS Code Profiles view also opens the Extension Matrix. A value the user set
 * under the current name wins, then one set under the old name, then the default (on).
 */
export function opensMatrixWithSidebar(current: InspectedSetting, legacy: InspectedSetting): boolean {
  return userValue(current) ?? userValue(legacy) ?? true;
}
