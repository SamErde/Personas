import * as vscode from 'vscode';
import { areFsPathsEqual, type Platform, type WatchTarget } from './core/paths';
import { createCliRunner } from './core/cliRunner';
import { GitConfigService } from './git/configService';
import { findGitExecutable } from './git/executable';
import { GitConfigurationView, type GitNode } from './panel/gitConfigurationView';
import { PowerShellProfilesViewProvider } from './panel/powerShellProfilesView';
import { showPowerShellHelp } from './panel/powerShellHelp';
import { openPersonasSettings } from './panel/settingsActions';
import { VsCodeProfilesViewProvider } from './panel/vscodeProfilesView';
import { MatrixPanel } from './panel/matrixPanel';
import {
  openGeneratedReadOnly,
  registerPersonasReadOnlyProvider,
  type PersonasReadOnlyContentProvider,
} from './panel/readOnlyProvider';
import { getOrBuildServices, setOnServicesBuilt, type Services } from './servicesFactory';

let vscodeProfiles: VsCodeProfilesViewProvider | undefined;
let readOnlyProvider: PersonasReadOnlyContentProvider | undefined;

const EFFECTIVE_GIT_CONFIGURATION = 'Effective Git Configuration (read-only)';
// Reading config is quick; this only stops a hung `git` from holding the view's refresh queue.
const GIT_CLI_TIMEOUT_MS = 15_000;

/** The Git executable: the first entry of VS Code's own `git.path` setting that exists, otherwise `git` on `PATH`. */
function gitPath(): Promise<string | undefined> {
  const setting = vscode.workspace.getConfiguration('git').get<unknown>('path');
  const configured = (Array.isArray(setting) ? setting : [setting]).filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim() !== '',
  );
  return findGitExecutable(configured, { platform: process.platform as Platform, env: process.env });
}

/** Git Configuration: a native tree view, and the read-only document of every value in effect. */
function registerGitConfiguration(context: vscode.ExtensionContext, documents: PersonasReadOnlyContentProvider): void {
  const service = new GitConfigService({
    run: createCliRunner({ platform: process.platform as Platform, timeoutMs: GIT_CLI_TIMEOUT_MS }),
    gitPath,
  });
  // An open Effective Git Configuration document follows the view.
  const view = new GitConfigurationView(service, { onRefreshed: () => documents.refreshOpenDocuments() });
  documents.registerGenerated(EFFECTIVE_GIT_CONFIGURATION, () => view.effectiveText());
  context.subscriptions.push(
    view,
    vscode.commands.registerCommand('personas.gitConfiguration.refresh', () => view.refresh()),
    vscode.commands.registerCommand('personas.gitConfiguration.showEffective', async () => {
      await view.refresh();
      await openGeneratedReadOnly(EFFECTIVE_GIT_CONFIGURATION, 'plaintext');
    }),
    vscode.commands.registerCommand('personas.gitConfiguration.openFile', (node?: GitNode) => view.openFile(node)),
  );
}

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
  registerGitConfiguration(context, readOnlyProvider);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('personas.powerShellProfiles')) {
        powerShellProfiles.settingsChanged(e.affectsConfiguration('personas.powerShellProfiles.includeWindowsPowerShell'));
      }
      if (e.affectsConfiguration('personas.showAgentsWindowProfile')) scheduleRefresh();
    }),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VsCodeProfilesViewProvider.viewId, vscodeProfiles),
    vscode.window.registerWebviewViewProvider(PowerShellProfilesViewProvider.viewId, powerShellProfiles),
    vscode.commands.registerCommand('personas.openSettings', () => openPersonasSettings()),
    // The buttons in the PowerShell Profiles view's title bar.
    vscode.commands.registerCommand('personas.powerShellProfiles.refresh', () => powerShellProfiles.refresh()),
    vscode.commands.registerCommand('personas.powerShellProfiles.help', () => showPowerShellHelp()),
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
