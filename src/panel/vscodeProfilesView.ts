import * as vscode from 'vscode';
import { buildOrphanInfos } from '../core/cleanup';
import { asError } from '../core/errors';
import { profileExtensionCounts, profileManifestPath } from '../core/inventory';
import { isAgentsWindowProfile, orphanCount, profileLabel } from '../core/inventoryQueries';
import { workspaceExtensionCounts } from '../core/workspace';
import type { HomeProfileVm, HomeWorkspaceVm, HostToVsCodeProfiles, VsCodeProfilesToHost } from '../protocol';
import { getOrBuildServices } from '../servicesFactory';
import { statFolder } from './fsStat';
import { resolveWorkspaceManifestAction } from './homeActions';
import {
  LEGACY_OPEN_WITH_SIDEBAR_SETTING,
  OPEN_WITH_SIDEBAR_SETTING,
  opensMatrixWithSidebar,
} from './matrixAutoOpen';
import { shownInventory } from './profileVisibility';
import { openReadOnly } from './readOnlyProvider';
import { renderSidebarPage } from './sidebarPage';
import { vscodeProfilesBody, vscodeProfilesStyles } from './vscodeProfilesMarkup';

/**
 * VS Code Profiles, one of Home's views. Owns no business logic of its own: counts, orphan detection
 * and sizing all come from pure/core helpers (`profileExtensionCounts`, `buildOrphanInfos`) — this
 * class only wires services to the view's page and reacts to its messages. It reaches the Extension
 * Matrix only through commands, never by importing MatrixPanel. The page's script is
 * dist/vscodeProfiles.js, built from src/webview/vscodeProfiles.ts.
 */
export class VsCodeProfilesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'personas.vscodeProfiles';
  private view: vscode.WebviewView | undefined;
  private profiles: HomeProfileVm[] = [];
  private workspaceManifestPath: string | undefined;
  private renderGeneration = 0;
  /** What the page last showed, repainted when the view is rebuilt (#150). */
  private lastState: Exclude<HostToVsCodeProfiles, { type: 'orphanSize' }> | undefined;
  private lastOrphanSize: Extract<HostToVsCodeProfiles, { type: 'orphanSize' }> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((m: VsCodeProfilesToHost) => void this.onMessage(m));

    // resolveWebviewView doesn't re-fire on later re-clicks (the view stays resolved once
    // created), so also auto-open on visibility change to visible — this covers re-clicking the
    // activity-bar icon after the matrix editor tab was closed.
    //
    // Neither place loads Home's content. VS Code discards this webview's page whenever the view
    // is hidden and loads it again when shown, and the page's script sends `ready` each time it
    // loads. That message alone drives the load, so each section is read once per show (#150).
    this.maybeAutoOpen();
    const visibilityListener = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.maybeAutoOpen();
    });
    webviewView.onDidDispose(() => {
      visibilityListener.dispose();
      if (this.view === webviewView) this.view = undefined;
    });
    this.context.subscriptions.push(visibilityListener);
  }

  /**
   * Invoked by extension.ts's debounced file-watcher hook when profile/extension data on disk
   * changes. A no-op while the view is disposed or hidden — the next resolve or
   * visibility-change-to-visible picks up the latest data instead.
   */
  async refresh(): Promise<void> {
    if (!this.view?.visible) return;
    await this.render();
  }

  /** Showing this view opens the Extension Matrix too, unless the user turned that off. */
  private maybeAutoOpen(): void {
    const settings = vscode.workspace.getConfiguration('personas');
    const enabled = opensMatrixWithSidebar(
      settings.inspect<boolean>(OPEN_WITH_SIDEBAR_SETTING),
      settings.inspect<boolean>(LEGACY_OPEN_WITH_SIDEBAR_SETTING),
    );
    if (enabled) void vscode.commands.executeCommand('personas.showMatrix');
  }

  private post(message: HostToVsCodeProfiles): void {
    void this.view?.webview.postMessage(message);
  }

  private async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    const setup = await getOrBuildServices(this.context);
    if (generation !== this.renderGeneration) return;
    if ('error' in setup) {
      this.profiles = [];
      this.workspaceManifestPath = undefined;
      this.lastState = { type: 'unsupported', reason: setup.error };
      this.lastOrphanSize = undefined;
      this.post(this.lastState);
      return;
    }
    const inventory = await setup.inventory.getInventory();
    const counts = profileExtensionCounts(inventory);
    const profiles = shownInventory(inventory).profiles.map((p) => ({
      id: p.id,
      name: p.name,
      ...profileLabel(p),
      agentsWindow: isAgentsWindowProfile(p),
      inheritsDefaultExtensions: p.inheritsDefaultExtensions,
      direct: counts.get(p.id)?.direct ?? 0,
      fromDefault: counts.get(p.id)?.fromDefault ?? 0,
      appliedToAllProfiles: counts.get(p.id)?.appliedToAllProfiles ?? 0,
      filePath: profileManifestPath(setup.paths, p),
    }));
    const orphanedCount = orphanCount(inventory);
    const workspaceInventory = await setup.workspace.getWorkspaceInventory(inventory);
    if (generation !== this.renderGeneration) return;
    const workspace: HomeWorkspaceVm | undefined = workspaceInventory
      ? {
          name: workspaceInventory.descriptor.name,
          kind: workspaceInventory.descriptor.kind,
          ...(workspaceInventory.descriptor.manifestFsPath
            ? { manifestFsPath: workspaceInventory.descriptor.manifestFsPath }
            : {}),
          ...(workspaceInventory.activeProfileName
            ? { activeProfileName: workspaceInventory.activeProfileName }
            : {}),
          counts: workspaceExtensionCounts(workspaceInventory),
          warnings: workspaceInventory.warnings,
        }
      : undefined;
    this.profiles = profiles;
    this.workspaceManifestPath = workspace?.manifestFsPath;
    this.lastState = {
      type: 'state',
      profiles,
      ...(workspace ? { workspace } : {}),
      orphanCount: orphanedCount,
      warnings: inventory.warnings,
    };
    // The remembered size was measured for the previous orphans, so it must not sit beside this
    // count. The scan below measures these ones.
    this.lastOrphanSize = undefined;
    this.post(this.lastState);

    if (orphanedCount > 0) {
      // Sent as a follow-up patch, not blocking the state push above: the size walk is a real
      // disk scan and the count should render immediately.
      const orphans = await buildOrphanInfos(inventory, statFolder);
      if (generation !== this.renderGeneration) return;
      const totalSizeBytes = orphans.reduce((sum, o) => sum + o.totalSizeBytes, 0);
      this.lastOrphanSize = { type: 'orphanSize', totalSizeBytes };
      this.post(this.lastOrphanSize);
    }
  }

  private async onMessage(m: VsCodeProfilesToHost): Promise<void> {
    if (m.type === 'openWorkspaceReadOnly' || m.type === 'editWorkspaceFile') {
      const action = resolveWorkspaceManifestAction(m, this.workspaceManifestPath);
      if (!action) return;
      if (action.mode === 'readOnly') {
        await openReadOnly(
          `${vscode.workspace.name ?? 'Workspace'} — .code-workspace (read-only)`,
          action.filePath,
          'jsonc',
        );
      } else {
        await this.openEditableFile(action.filePath);
      }
      return;
    }
    switch (m.type) {
      case 'ready':
        // The page was just rebuilt and is empty: show what it last held, then refresh.
        if (this.lastState) this.post(this.lastState);
        if (this.lastOrphanSize) this.post(this.lastOrphanSize);
        await this.render();
        return;
      case 'openMatrix':
        await vscode.commands.executeCommand('personas.showMatrix');
        return;
      case 'editProfileFile': {
        const profile = this.profiles.find((p) => p.id === m.profileId);
        if (!profile?.filePath) return;
        await this.openEditableFile(profile.filePath);
        return;
      }
      case 'reviewOrphans':
        await vscode.commands.executeCommand('personas.reviewOrphans');
        return;
    }
  }

  private async openEditableFile(filePath: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Personas: couldn't open ${filePath} — ${asError(e).message}`,
      );
    }
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'vscodeProfiles.js'));
    return renderSidebarPage({
      title: 'VS Code Profiles',
      styles: vscodeProfilesStyles,
      body: vscodeProfilesBody,
      scriptUri: script.toString(),
    });
  }
}
