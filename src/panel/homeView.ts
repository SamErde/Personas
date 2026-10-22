import * as vscode from 'vscode';
import { buildOrphanInfos } from '../core/cleanup';
import { asError } from '../core/errors';
import { profileExtensionCounts, profileManifestPath } from '../core/inventory';
import { orphanCount } from '../core/inventoryQueries';
import { workspaceExtensionCounts } from '../core/workspace';
import type { HomeProfileVm, HomeToHost, HomeWorkspaceVm, HostToHome } from '../protocol';
import { getOrBuildServices } from '../servicesFactory';
import { statFolder } from './fsStat';
import { resolveWorkspaceManifestAction } from './homeActions';
import { openReadOnly } from './readOnlyProvider';
import { createNonce, homeContentSecurityPolicy, renderContentSecurityPolicyMeta } from './webviewSecurity';

/**
 * Home, the Personas sidebar: one section per area, currently only Profiles & Extensions. Owns no
 * business logic of its own: counts, orphan detection and sizing all come from pure/core helpers
 * (`profileExtensionCounts`, `buildOrphanInfos`) — this class only wires services to the webview
 * and reacts to its messages. It reaches the Extension Matrix only through commands, never by
 * importing MatrixPanel. The rendering script lives in dist/home.js (built from
 * src/webview/home.ts) rather than inline, to keep this file's HTML skeleton small.
 */
export class HomeViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private profiles: HomeProfileVm[] = [];
  private workspaceManifestPath: string | undefined;
  private renderGeneration = 0;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((m: HomeToHost) => void this.onMessage(m));

    // resolveWebviewView doesn't re-fire on later re-clicks (the view stays resolved once
    // created), so also auto-open on visibility change to visible — this covers re-clicking the
    // activity-bar icon after the matrix editor tab was closed. Home itself is
    // re-rendered on the same trigger, so it never goes stale while hidden.
    this.maybeAutoOpen();
    void this.render();
    const visibilityListener = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.maybeAutoOpen();
        void this.render();
      }
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

  private maybeAutoOpen(): void {
    const enabled = vscode.workspace
      .getConfiguration('personas')
      .get<boolean>('openMatrixOnActivityBarClick', true);
    if (enabled) void vscode.commands.executeCommand('personas.showMatrix');
  }

  private post(message: HostToHome): void {
    void this.view?.webview.postMessage(message);
  }

  private async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    const setup = await getOrBuildServices(this.context);
    if (generation !== this.renderGeneration) return;
    if ('error' in setup) {
      this.profiles = [];
      this.workspaceManifestPath = undefined;
      this.post({ type: 'unsupported', reason: setup.error });
      return;
    }
    const inventory = await setup.inventory.getInventory();
    const counts = profileExtensionCounts(inventory);
    const profiles = inventory.profiles.map((p) => ({
      id: p.id,
      name: p.name,
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
    this.post({
      type: 'state',
      profiles,
      ...(workspace ? { workspace } : {}),
      orphanCount: orphanedCount,
      warnings: inventory.warnings,
    });

    if (orphanedCount > 0) {
      // Sent as a follow-up patch, not blocking the state push above: the size walk is a real
      // disk scan and the count should render immediately.
      const orphans = await buildOrphanInfos(inventory, statFolder);
      if (generation !== this.renderGeneration) return;
      const totalSizeBytes = orphans.reduce((sum, o) => sum + o.totalSizeBytes, 0);
      this.post({ type: 'orphanSize', totalSizeBytes });
    }
  }

  private async onMessage(m: HomeToHost): Promise<void> {
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
        await this.render();
        return;
      case 'openMatrix':
        await vscode.commands.executeCommand('personas.showMatrix');
        return;
      case 'openProfileReadOnly': {
        const profile = this.profiles.find((p) => p.id === m.profileId);
        if (!profile?.filePath) return;
        await openReadOnly(`${profile.name} — extensions.json (read-only)`, profile.filePath);
        return;
      }
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
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'home.js'));
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
${renderContentSecurityPolicyMeta(homeContentSecurityPolicy(nonce))}
<title>Personas</title>
<style nonce="${nonce}">
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 0.5rem 1rem;
  }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 0.3rem 0.7rem;
    border-radius: 1rem;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  h2 { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em; margin: 0.5rem 0 0.5rem; }
  h3 { font-size: 0.95em; margin: 1rem 0 0.25rem; }
  .home-section + .home-section { margin-top: 1.25rem; }
  #profiles { list-style: none; margin: 0; padding: 0; }
  #profiles li { margin: 0 0 8px; }
  #profiles li:last-child { margin-bottom: 0; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
  a:hover, a:focus { text-decoration: underline; }
  .profile-line1 { display: flex; align-items: center; gap: 0.3rem; }
  .profile-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edit-icon { margin-left: 0.35rem; flex-shrink: 0; }
  .edit-icon:focus { outline: 1px solid var(--vscode-focusBorder); }
  .inherits { opacity: 0.75; font-size: 0.9em; margin-left: 0.3rem; flex-shrink: 0; }
  .profile-counts { margin-top: 0.15rem; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .workspace-card {
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.75rem;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-sideBar-background);
    color: var(--vscode-foreground);
  }
  .workspace-matrix {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 0.65rem;
    text-align: left;
    border: none;
    border-radius: 3px 3px 0 0;
    background: transparent;
    color: inherit;
  }
  .workspace-matrix:hover { background: var(--vscode-list-hoverBackground); }
  .workspace-matrix:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .workspace-actions {
    display: flex;
    gap: 0.35rem;
    padding: 0 0.65rem 0.55rem;
  }
  .workspace-action {
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--vscode-textLink-foreground);
    font-size: 0.85em;
  }
  .workspace-action:hover, .workspace-action:focus {
    background: transparent;
    text-decoration: underline;
  }
  .workspace-title { font-weight: 600; }
  .workspace-name { color: var(--vscode-textLink-foreground); margin-top: 0.15rem; }
  .workspace-readonly, .workspace-counts, .workspace-profile {
    margin-top: 0.2rem;
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
  }
  .workspace-warning { margin: 0.25rem 0 0; font-size: 0.85em; }
  #extra p { margin: 0.4rem 0; }
  .warning-line { opacity: 0.9; }
</style>
</head>
<body>
<section class="home-section" aria-labelledby="profiles-extensions-heading">
<h2 id="profiles-extensions-heading">Profiles &amp; Extensions</h2>
<div id="launcher">
<button id="open">Open Extension Matrix</button>
</div>
<div id="profiles-extensions">
<h3>Profiles</h3>
<ul id="profiles"></ul>
<div id="workspace"></div>
<div id="extra"></div>
</div>
</section>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
