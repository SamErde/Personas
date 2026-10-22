import * as vscode from 'vscode';
import { areFsPathsEqual, type Platform, type WatchTarget } from './core/paths';
import { HomeViewProvider } from './panel/homeView';
import { MatrixPanel } from './panel/matrixPanel';
import { registerPersonasReadOnlyProvider, type PersonasReadOnlyContentProvider } from './panel/readOnlyProvider';
import { getOrBuildServices, setOnServicesBuilt, type Services } from './servicesFactory';

let homeProvider: HomeViewProvider | undefined;
let readOnlyProvider: PersonasReadOnlyContentProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  readOnlyProvider = registerPersonasReadOnlyProvider(context);

  // Watchers start with service construction, not with the showMatrix command: Home and open
  // personas-readonly documents must live-update even when the user disables
  // openMatrixOnActivityBarClick and never opens the matrix. Fires once, on the first successful
  // build, from whichever caller (showMatrix or Home) builds services first; the
  // unsupported-environment error path never fires it.
  setOnServicesBuilt((ctx, services) => watchForChanges(ctx, services));

  homeProvider = new HomeViewProvider(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('personas.home', homeProvider));
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
    void homeProvider?.refresh();
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
