import * as vscode from 'vscode';
import { MatrixPanel } from './panel/matrixPanel';
import { registerPersonasReadOnlyProvider, type PersonasReadOnlyContentProvider } from './panel/readOnlyProvider';
import { WelcomeViewProvider } from './panel/welcomeView';
import { getOrBuildServices, setOnServicesBuilt, type Services } from './servicesFactory';

let welcomeProvider: WelcomeViewProvider | undefined;
let readOnlyProvider: PersonasReadOnlyContentProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  readOnlyProvider = registerPersonasReadOnlyProvider(context);

  // Watchers start with service construction, not with the showMatrix command: the sidebar
  // dashboard and open personas-readonly documents must live-update even when the user disables
  // openMatrixOnActivityBarClick and never opens the matrix. Fires once, on the first successful
  // build, from whichever caller (showMatrix or the welcome view) builds services first; the
  // unsupported-environment error path never fires it.
  setOnServicesBuilt((ctx, services) => watchForChanges(ctx, services));

  welcomeProvider = new WelcomeViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('personas.welcome', welcomeProvider),
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
  );
}

export function deactivate(): void {}

const watchedDirs = new Set<string>();
let workspaceWatchers: vscode.FileSystemWatcher[] = [];
let watchTimer: NodeJS.Timeout | undefined;
function scheduleRefresh(): void {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    void MatrixPanel.current?.refresh();
    void welcomeProvider?.refresh();
    // Open personas-readonly documents are live windows onto profile or workspace manifests.
    readOnlyProvider?.refreshOpenDocuments();
  }, 300);
}

function watchForChanges(context: vscode.ExtensionContext, services: Services): void {
  for (const p of services.watched) {
    const dir = dirOf(p);
    if (watchedDirs.has(dir)) continue;
    watchedDirs.add(dir);
    const pattern = new vscode.RelativePattern(vscode.Uri.file(p).with({ path: dir }), '**');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
    context.subscriptions.push(watcher);
  }

  const rebuildWorkspaceWatchers = () => {
    for (const watcher of workspaceWatchers) watcher.dispose();
    workspaceWatchers = services.workspace.watchedTargets().map((target) => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(target.baseFsPath), target.pattern),
      );
      watcher.onDidChange(scheduleRefresh);
      watcher.onDidCreate(scheduleRefresh);
      watcher.onDidDelete(scheduleRefresh);
      return watcher;
    });
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

function dirOf(p: string): string {
  const norm = p.replaceAll('\\', '/');
  return norm.endsWith('.json') || norm.endsWith('.obsolete') ? norm.slice(0, norm.lastIndexOf('/')) : norm;
}
