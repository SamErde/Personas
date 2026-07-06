import * as vscode from 'vscode';
import { buildOrphanInfos } from '../core/cleanup';
import { profileExtensionCounts, profileManifestPath } from '../core/inventory';
import type { HostToWelcome, WelcomeProfileVm, WelcomeToHost } from '../core/types';
import { getOrBuildServices } from '../servicesFactory';
import { statFolder } from './fsStat';
import { MatrixPanel } from './matrixPanel';
import { openReadOnly } from './readOnlyProvider';

/**
 * Sidebar mini-dashboard for the activity-bar view. Owns no business logic of its own: counts,
 * orphan detection and sizing all come from pure/core helpers (`profileExtensionCounts`,
 * `buildOrphanInfos`) — this class only wires services to the webview and reacts to its messages.
 * The rendering script itself lives in dist/welcome.js (built from src/webview/welcome.ts) rather
 * than inline, to keep this file's HTML skeleton small. The themed "Open Extension Matrix" button
 * and auto-open-on-click behavior are unchanged.
 */
export class WelcomeViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private profiles: WelcomeProfileVm[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((m: WelcomeToHost) => void this.onMessage(m));

    // resolveWebviewView doesn't re-fire on later re-clicks (the view stays resolved once
    // created), so also auto-open on visibility change to visible — this covers re-clicking the
    // activity-bar icon after the matrix editor tab was closed. The dashboard itself is
    // re-rendered on the same trigger, so it never goes stale while hidden.
    this.maybeAutoOpen();
    void this.renderDashboard();
    const visibilityListener = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.maybeAutoOpen();
        void this.renderDashboard();
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
    await this.renderDashboard();
  }

  private maybeAutoOpen(): void {
    const enabled = vscode.workspace
      .getConfiguration('personas')
      .get<boolean>('openMatrixOnActivityBarClick', true);
    if (enabled) void vscode.commands.executeCommand('personas.showMatrix');
  }

  private post(message: HostToWelcome): void {
    void this.view?.webview.postMessage(message);
  }

  private async renderDashboard(): Promise<void> {
    const setup = await getOrBuildServices(this.context);
    if ('error' in setup) {
      this.profiles = [];
      this.post({ type: 'unsupported', reason: setup.error });
      return;
    }
    const inventory = await setup.inventory.getInventory();
    const counts = profileExtensionCounts(inventory);
    this.profiles = inventory.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      inheritsDefaultExtensions: p.inheritsDefaultExtensions,
      direct: counts.get(p.id)?.direct ?? 0,
      shared: counts.get(p.id)?.shared ?? 0,
      filePath: profileManifestPath(setup.paths, p),
    }));
    const orphanCount = inventory.extensions.filter((e) => e.orphaned).length;
    this.post({ type: 'state', profiles: this.profiles, orphanCount, warnings: inventory.warnings });

    if (orphanCount > 0) {
      // Sent as a follow-up patch, not blocking the state push above: the size walk is a real
      // disk scan and the count should render immediately.
      const orphans = await buildOrphanInfos(inventory, statFolder);
      const totalSizeBytes = orphans.reduce((sum, o) => sum + o.totalSizeBytes, 0);
      this.post({ type: 'orphanSize', totalSizeBytes });
    }
  }

  private async onMessage(m: WelcomeToHost): Promise<void> {
    switch (m.type) {
      case 'ready':
        await this.renderDashboard();
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
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(profile.filePath));
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch (e) {
          void vscode.window.showErrorMessage(
            `Personas: couldn't open ${profile.filePath} — ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        return;
      }
      case 'reviewOrphans':
        // Same host round trip the matrix's own "Review…" button takes, just triggered from the
        // sidebar: show the matrix, then jump it straight into the cleanup view.
        await vscode.commands.executeCommand('personas.showMatrix');
        await MatrixPanel.current?.openCleanup();
        return;
    }
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'welcome.js'));
    const nonce = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
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
  h2 { font-size: 0.95em; margin: 1rem 0 0.25rem; }
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
  #extra p { margin: 0.4rem 0; }
  .warning-line { opacity: 0.9; }
</style>
</head>
<body>
<div id="launcher">
<p>The Extension Matrix opens as an editor tab.</p>
<button id="open">Open Extension Matrix</button>
</div>
<div id="dashboard">
<h2>Profiles</h2>
<ul id="profiles"></ul>
<div id="extra"></div>
</div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
