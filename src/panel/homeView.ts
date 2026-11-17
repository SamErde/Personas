import { PowerShellController } from './powerShellController';
import * as vscode from 'vscode';
import { buildOrphanInfos } from '../core/cleanup';
import { asError } from '../core/errors';
import { profileExtensionCounts, profileManifestPath } from '../core/inventory';
import { isAgentsWindowProfile, orphanCount, profileLabel } from '../core/inventoryQueries';
import { workspaceExtensionCounts } from '../core/workspace';
import type { HomeProfileVm, HomeToHost, HomeWorkspaceVm, HostToHome } from '../protocol';
import { getOrBuildServices } from '../servicesFactory';
import { statFolder } from './fsStat';
import { resolveWorkspaceManifestAction } from './homeActions';
import { shownInventory } from './profileVisibility';
import { openReadOnly } from './readOnlyProvider';
import { createNonce, homeContentSecurityPolicy, renderContentSecurityPolicyMeta } from './webviewSecurity';

/**
 * Home, the Personas sidebar: several sections, one per area (VS Code Profiles and PowerShell
 * Profiles). Owns no business logic of its own: counts, orphan detection and sizing all come from
 * pure/core helpers (`profileExtensionCounts`, `buildOrphanInfos`) — this class only wires services
 * to the webview and reacts to its messages. It reaches the Extension Matrix only through commands, never by
 * importing MatrixPanel. The rendering script lives in dist/home.js (built from
 * src/webview/home.ts) rather than inline, to keep this file's HTML skeleton small.
 */
export class HomeViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private profiles: HomeProfileVm[] = [];
  private workspaceManifestPath: string | undefined;
  private renderGeneration = 0;

  private readonly powerShell: PowerShellController;
  constructor(private readonly context: vscode.ExtensionContext) {
    this.powerShell = new PowerShellController(message => this.post(message));
    context.subscriptions.push(this.powerShell);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.powerShell.setActive(webviewView.visible);
    if (webviewView.visible) void this.powerShell.refresh(true);
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
      this.powerShell.setActive(webviewView.visible);
      if (webviewView.visible) {
        void this.powerShell.refresh(true);
        this.maybeAutoOpen();
        void this.render();
      }
    });
    webviewView.onDidDispose(() => {
      visibilityListener.dispose();
      if (this.view === webviewView) {
        this.view = undefined;
        this.powerShell.setActive(false);
      }
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
    if (m.type === 'powerShellAction') { await this.powerShell.handle(m); return; }
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
        if (this.view?.visible) void this.powerShell.refresh(true);
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
  /* High-contrast themes can color a button the same as the surface behind it and rely on
   * contrastBorder for its edge. Other themes leave contrastBorder unset, so the border stays
   * transparent there. The shape follows VS Code's own text buttons (.monaco-text-button in
   * src/vs/base/browser/ui/button/button.css): a 1px border outside 4px by 8px padding and a 4px
   * corner radius. */
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-contrastBorder, transparent);
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  /* Full width up to the 300px cap VS Code gives the buttons in its views' welcome content
   * (.welcome-view-content > .button-container in src/vs/workbench/browser/parts/views/media/views.css). */
  .standard-button { display: block; box-sizing: border-box; width: 100%; max-width: 300px; }
  h2 { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em; margin: 0.5rem 0 0.5rem; }
  h3 { font-size: 0.95em; margin: 1rem 0 0.25rem; }
  .home-section + .home-section { margin-top: 1.25rem; }
  #profiles { list-style: none; margin: 0; padding: 0; }
  #profiles li { margin: 0 0 8px; }
  #profiles li:last-child { margin-bottom: 0; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
  a:hover, a:focus { text-decoration: underline; }
  #launcher { margin-bottom: 0.75rem; }
  .profile-line1 { display: flex; align-items: center; gap: 0.3rem; }
  .profile-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* An icon button in the manner of VS Code's view toolbar actions. */
  button.edit-icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: 0.35rem;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--vscode-icon-foreground);
    font: inherit;
  }
  button.edit-icon:hover {
    background: var(--vscode-toolbar-hoverBackground);
    outline: 1px dashed var(--vscode-contrastActiveBorder, transparent);
    outline-offset: -1px;
  }
  button.edit-icon:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
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
  /* The manifest actions are VS Code's secondary buttons: the same shape as Open Extension Matrix,
   * set below it in emphasis, and capped together at the same 300px. */
  .workspace-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    max-width: 300px;
    padding: 0 0.65rem 0.55rem;
  }
  /* The pair stacks when the sidebar is too narrow to fit both labels on one line. */
  .workspace-action {
    flex: 1 1 7rem;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .workspace-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
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

  button:disabled { opacity: .65; cursor: default; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }

  /* PowerShell Profiles: a compact list in the manner of VS Code's own views. */
  .ps-header { display: flex; align-items: center; gap: 2px; }
  .ps-header h2 { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-toolbar { display: flex; flex: none; gap: 2px; }
  /* VS Code dims secondary list text by opacity; several themes give description text the foreground color. */
  #powershell { margin: 0 -1rem; --ps-quiet: color-mix(in srgb, var(--vscode-foreground) 72%, transparent); }
  #powershell [hidden] { display: none; }
  .ps-message { margin: 0; padding: 0.15rem 1rem; color: var(--ps-quiet); }
  .ps-edition + .ps-edition { margin-top: 6px; }
  .ps-edition-name {
    margin: 0;
    padding: 0 1rem;
    line-height: 22px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ps-list { list-style: none; margin: 0; padding: 0; }
  .ps-icon {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ps-icon-more { stroke-width: 1.75; }
  button.ps-tool, button.ps-more, button.ps-open, button.ps-fold, button.ps-resolve, button.ps-menu-item {
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  button.ps-tool, button.ps-more {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    color: var(--vscode-icon-foreground);
  }
  button.ps-tool:hover, button.ps-more:hover, button.ps-more[aria-expanded="true"] {
    background: var(--vscode-toolbar-hoverBackground);
    outline: 1px dashed var(--vscode-contrastActiveBorder, transparent);
    outline-offset: -1px;
  }
  button.ps-tool:focus-visible, button.ps-more:focus-visible, button.ps-fold:focus-visible, button.ps-resolve:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }

  .ps-row, button.ps-fold, button.ps-resolve, .ps-note { height: 22px; line-height: 22px; }
  .ps-row { position: relative; display: flex; align-items: center; padding: 0 calc(1rem - 4px) 0 1rem; }
  .ps-row.ps-inert { padding-right: calc(1rem + 18px); }
  .ps-row:not(.ps-inert):hover, .ps-row:focus-within, .ps-row.ps-menu-open, button.ps-fold:hover, button.ps-resolve:hover {
    background: var(--vscode-list-hoverBackground);
    outline: 1px dashed var(--vscode-contrastActiveBorder, transparent);
    outline-offset: -1px;
  }
  .ps-row:has(button.ps-open:focus-visible) { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  button.ps-open { flex: 1 1 auto; min-width: 0; height: 100%; display: flex; align-items: center; gap: 6px; }
  button.ps-open:focus-visible { outline: none; }
  button.ps-open:disabled { opacity: 1; }
  .ps-label, .ps-description, .ps-fold-label, .ps-note-text, .ps-resolve-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ps-label { flex: 0 1 auto; }
  .ps-description { flex: 1 1 0; font-size: 0.9em; color: var(--ps-quiet); }
  .ps-tag { flex: none; font-size: 0.85em; color: var(--ps-quiet); }
  .ps-row[data-ps-state="missing"] button.ps-open, .ps-row[data-ps-state="unresolved"] button.ps-open {
    color: var(--ps-quiet);
  }
  .ps-row[data-ps-state="missing"] button.ps-open:enabled:hover, .ps-row[data-ps-state="missing"] button.ps-open:focus-visible {
    color: var(--vscode-foreground);
  }
  .ps-row[data-ps-state="brokenLink"] .ps-icon, .ps-row[data-ps-state="brokenLink"] .ps-tag, .ps-warning .ps-icon {
    color: var(--vscode-list-warningForeground);
  }
  .ps-row[data-ps-state="inaccessible"] .ps-icon, .ps-row[data-ps-state="inaccessible"] .ps-tag {
    color: var(--vscode-list-errorForeground);
  }
  button.ps-more { opacity: 0; }
  .ps-row:hover button.ps-more, .ps-row:focus-within button.ps-more, .ps-row.ps-menu-open button.ps-more { opacity: 1; }
  .ps-row[data-ps-state="brokenLink"] button.ps-more .ps-icon, .ps-row[data-ps-state="inaccessible"] button.ps-more .ps-icon {
    color: inherit;
  }

  button.ps-fold, button.ps-resolve, .ps-note {
    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    width: 100%;
    padding: 0 1rem;
    font-size: 0.9em;
    color: var(--ps-quiet);
  }
  button.ps-fold:hover, button.ps-fold:focus-visible { color: var(--vscode-foreground); }
  button.ps-fold[aria-expanded="true"] .ps-icon { transform: rotate(90deg); }
  button.ps-resolve { padding-left: calc(1rem + 22px); color: var(--vscode-textLink-foreground); }

  .ps-menu {
    position: absolute;
    z-index: 10;
    top: 100%;
    right: 8px;
    box-sizing: border-box;
    max-width: calc(100% - 16px);
    padding: 4px;
    line-height: normal;
    border: 1px solid var(--vscode-menu-border, var(--vscode-contrastBorder, transparent));
    border-radius: 5px;
    background: var(--vscode-menu-background);
    color: var(--vscode-menu-foreground);
    box-shadow: 0 2px 8px var(--vscode-widget-shadow);
  }
  .ps-menu.ps-menu-up { top: auto; bottom: 100%; }
  button.ps-menu-item {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 24px;
    padding: 0 8px;
    border-radius: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.ps-menu-item:enabled:hover, button.ps-menu-item:focus-visible {
    background: var(--vscode-menu-selectionBackground);
    color: var(--vscode-menu-selectionForeground);
    outline: 1px solid var(--vscode-contrastActiveBorder, transparent);
    outline-offset: -1px;
  }
  button.ps-menu-item:disabled { opacity: 1; color: var(--vscode-disabledForeground); }
  .ps-menu-separator { margin: 4px 0; border: none; border-top: 1px solid var(--vscode-menu-separatorBackground); }
</style>
</head>
<body>
<section class="home-section" aria-labelledby="profiles-extensions-heading">
<h2 id="profiles-extensions-heading">VS Code Profiles</h2>
<div id="launcher">
<button id="open" class="standard-button" type="button">Open Extension Matrix</button>
</div>
<div id="profiles-extensions">
<ul id="profiles"></ul>
<div id="workspace"></div>
<div id="extra"></div>
</div>
</section>
<section class="home-section" aria-labelledby="powershell-heading">
<div class="ps-header">
<h2 id="powershell-heading">PowerShell Profiles</h2>
<div id="powershell-toolbar" class="ps-toolbar" role="toolbar" aria-label="PowerShell Profiles actions"></div>
</div>
<div id="powershell" aria-live="polite"><p class="ps-message">Discovering PowerShell profiles…</p></div>
</section>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
