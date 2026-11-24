import * as vscode from 'vscode';
import { areFsPathsEqual, type Platform, type WatchTarget } from './core/paths';
import { PowerShellProfilesViewProvider } from './panel/powerShellProfilesView';
import { VsCodeProfilesViewProvider } from './panel/vscodeProfilesView';
import { MatrixPanel } from './panel/matrixPanel';
import { registerPersonasReadOnlyProvider, type PersonasReadOnlyContentProvider } from './panel/readOnlyProvider';
import { getOrBuildServices, setOnServicesBuilt, type Services } from './servicesFactory';

let vscodeProfiles: VsCodeProfilesViewProvider | undefined;
let readOnlyProvider: PersonasReadOnlyContentProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  readOnlyProvider = registerPersonasReadOnlyProvider(context);

  // Watchers start with service construction, not with the showMatrix command: Home and open
  // personas-readonly documents must live-update even when the user disables
  // personas.extensionMatrix.openWithSidebar and never opens the matrix. Fires once, on the first successful
  // build, from whichever caller (showMatrix or Home) builds services first; the unsupported-
  // environment error path never fires it.
  setOnServicesBuilt((ctx, services) => watchForChanges(ctx, services));

  // Home: one sidebar view per area. Each loads on its own, so a slow one never holds up another.
  vscodeProfiles = new VsCodeProfilesViewProvider(context);
  const powerShellProfiles = new PowerShellProfilesViewProvider(context);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('personas.showAgentsWindowProfile')) scheduleRefresh();
    }),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VsCodeProfilesViewProvider.viewId, vscodeProfiles),
    vscode.window.registerWebviewViewProvider(PowerShellProfilesViewProvider.viewId, powerShellProfiles),
    // The buttons in the PowerShell Profiles view's title bar.
    vscode.commands.registerCommand('personas.powerShellProfiles.refresh', () => powerShellProfiles.refresh()),
    vscode.commands.registerCommand('personas.powerShellProfiles.help', () => powerShellProfiles.help()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('personas.showMatrix', async () => {
      const setup = await getOrBuildServices(context);
      if ('error' in setup) {
        // Primary cue: the panel itself renders the can't-manage state (never a blank screen).
        MatrixPanel.showUnsupported(context, setup.error);
        // Secondary cue: a toast, kept for users who miss/close the panel.
        void vscode.window.showErrorMessage(
          `Personas can't manage profiles in this environment: ${setup.error}`,
        );
        return;
      }
      MatrixPanel.show(context, setup);
      await MatrixPanel.current?.refresh();
    }),
    // Internal (not contributed): Home's orphan summary opens the matrix straight into its cleanup
    // view. Home reaches the matrix only through commands, so neither panel imports the other.
    vscode.commands.registerCommand('personas.reviewOrphans', async () => {
      await vscode.commands.executeCommand('personas.showMatrix');
      await MatrixPanel.current?.openCleanup();
    }),
  );
}

export function deactivate(): void {}

let workspaceWatchers: vscode.FileSystemWatcher[] = [];
let watchTimer: NodeJS.Timeout | undefined;
function scheduleRefresh(): void {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    void MatrixPanel.current?.refresh();
    void vscodeProfiles?.refresh();
    // Open personas-readonly documents are live windows onto profile or workspace manifests.
    readOnlyProvider?.refreshOpenDocuments();
  }, 300);
}

function createWatcher(target: WatchTarget, platform: Platform): vscode.FileSystemWatcher {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(target.baseFsPath), target.pattern),
  );
  const refreshIfMatched = (uri: vscode.Uri) => {
    if (!target.exactFsPath || areFsPathsEqual(target.exactFsPath, uri.fsPath, platform)) scheduleRefresh();
  };
  watcher.onDidChange(refreshIfMatched);
  watcher.onDidCreate(refreshIfMatched);
  watcher.onDidDelete(refreshIfMatched);
  return watcher;
}

function watchForChanges(context: vscode.ExtensionContext, services: Services): void {
  const { platform } = services.paths;
  for (const target of services.watched) context.subscriptions.push(createWatcher(target, platform));

  const rebuildWorkspaceWatchers = () => {
    for (const watcher of workspaceWatchers) watcher.dispose();
    workspaceWatchers = services.workspace.watchedTargets().map((target) => createWatcher(target, platform));
  };
  rebuildWorkspaceWatchers();
  context.subscriptions.push(
    vscode.extensions.onDidChange(scheduleRefresh),
    vscode.workspace.onDidGrantWorkspaceTrust(scheduleRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      rebuildWorkspaceWatchers();
      scheduleRefresh();
    }),
    {
      dispose: () => {
        clearTimeout(watchTimer);
        for (const watcher of workspaceWatchers) watcher.dispose();
        workspaceWatchers = [];
      },
    },
  );
}
