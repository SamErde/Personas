import * as vscode from 'vscode';
import { MatrixPanel } from './panel/matrixPanel';
import { registerPersonasReadOnlyProvider, type PersonasReadOnlyContentProvider } from './panel/readOnlyProvider';
import { WelcomeViewProvider } from './panel/welcomeView';
import { getOrBuildServices, setOnServicesBuilt } from './servicesFactory';

let welcomeProvider: WelcomeViewProvider | undefined;
let readOnlyProvider: PersonasReadOnlyContentProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  readOnlyProvider = registerPersonasReadOnlyProvider(context);

  // Watchers start with service construction, not with the showMatrix command: the sidebar
  // dashboard and open personas-readonly documents must live-update even when the user disables
  // openMatrixOnActivityBarClick and never opens the matrix. Fires once, on the first successful
  // build, from whichever caller (showMatrix or the welcome view) builds services first; the
  // unsupported-environment error path never fires it.
  setOnServicesBuilt((ctx, services) => watchForChanges(ctx, services.watched));

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
let watchTimer: NodeJS.Timeout | undefined;
function scheduleRefresh(): void {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    void MatrixPanel.current?.refresh();
    void welcomeProvider?.refresh();
    // Open personas-readonly documents are live windows onto profile manifests — re-provide them too.
    readOnlyProvider?.refreshOpenDocuments();
  }, 300);
}

function watchForChanges(context: vscode.ExtensionContext, watched: string[]): void {
  for (const p of watched) {
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
}

function dirOf(p: string): string {
  const norm = p.replaceAll('\\', '/');
  return norm.endsWith('.json') || norm.endsWith('.obsolete') ? norm.slice(0, norm.lastIndexOf('/')) : norm;
}
