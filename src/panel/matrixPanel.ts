import * as vscode from 'vscode';
import { buildOrphanInfos } from '../core/cleanup';
import { MatrixActions } from '../core/matrixActions';
import { asError } from '../core/errors';
import { offersWorkspaceEnablementGuide } from '../core/inventoryQueries';
import type { Inventory, WorkspaceInventory } from '../core/types';
import type { HostToMatrix, MatrixToHost } from '../protocol';
import type { Services } from '../servicesFactory';
import { statFolder } from './fsStat';
import { createNonce, matrixContentSecurityPolicy, renderContentSecurityPolicyMeta } from './webviewSecurity';

export class MatrixPanel {
  static current: MatrixPanel | undefined;

  static show(context: vscode.ExtensionContext, services: Services): void {
    MatrixPanel.open(context, services, undefined);
  }

  /**
   * Opens the panel in the terminal "can't manage profiles here" state instead of the matrix.
   * Per the design spec's error-handling class 1, the panel must never be a blank screen even
   * when the environment is unsupported — the webview renders `reason` once it signals ready.
   */
  static showUnsupported(context: vscode.ExtensionContext, reason: string): void {
    MatrixPanel.open(context, undefined, reason);
  }

  private static open(context: vscode.ExtensionContext, services: Services | undefined, reason: string | undefined): void {
    if (MatrixPanel.current) {
      MatrixPanel.current.panel.reveal();
      return;
    }
    const localResourceRoots = [vscode.Uri.joinPath(context.extensionUri, 'dist')];
    // Icons are served straight from the extensions folder; unsupported mode shows none.
    if (services) localResourceRoots.push(vscode.Uri.file(services.paths.extensionsDir));
    const panel = vscode.window.createWebviewPanel('personas.matrix', 'Extension Matrix', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots,
    });
    MatrixPanel.current = new MatrixPanel(panel, context, services, reason);
  }

  private lastInventory: Inventory | undefined;
  private lastWorkspace: WorkspaceInventory | undefined;
  private refreshQueue: Promise<void> = Promise.resolve();
  private messageQueue: Promise<void> = Promise.resolve();
  private readonly actions: MatrixActions | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly services: Services | undefined,
    /** Set only by `showUnsupported`. When defined, the panel is permanently in the terminal
     *  can't-manage state and every mutating message is guarded out in `onMessage`. */
    private readonly unsupportedReason: string | undefined,
  ) {
    this.actions = services && new MatrixActions({
      mutations: services.mutations,
      cleanup: services.cleanup,
      ui: {
        confirm: async (message, action) =>
          (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action,
        // Not awaited, for the same reason as the error notification in guard().
        inform: (message) => void vscode.window.showInformationMessage(message),
        markPending: (extId, profileId) => this.post({ type: 'pending', extId, profileId }),
        showCleanupResult: (results) => this.post({ type: 'cleanupResult', results }),
      },
      refresh: () => this.refresh(),
    });
    panel.webview.html = this.html(context);
    panel.onDidDispose(() => (MatrixPanel.current = undefined));
    panel.webview.onDidReceiveMessage((m: MatrixToHost) => void this.enqueue(() => this.onMessage(m)));
  }

  /**
   * Handles panel work one item at a time, so a confirm-then-change flow can't interleave with
   * another one acting on the same (by then stale) `lastInventory`. Every item runs through
   * guard(), so a failure never stalls the queue.
   */
  private enqueue(work: () => Promise<void>): Promise<void> {
    const task = this.messageQueue.then(work);
    this.messageQueue = task.catch(() => undefined);
    return task;
  }

  refresh(): Promise<void> {
    // A mutation refresh can race a watcher refresh. Serialize complete snapshots so inventory and
    // workspace composition from different runs can never be mixed, and keep the queue usable when
    // an individual refresh rejects.
    const task = this.refreshQueue.then(() => this.performRefresh());
    this.refreshQueue = task.catch(() => undefined);
    return task;
  }

  private async performRefresh(): Promise<void> {
    if (!this.services) return; // unsupported mode — nothing to read; see onMessage's guard.
    const inventory = await this.services.inventory.getInventory();
    const workspace = await this.services.workspace.getWorkspaceInventory(inventory);
    const icons: Record<string, string> = {};
    for (const ext of inventory.extensions) {
      if (ext.iconFsPath) {
        icons[ext.id] = this.panel.webview.asWebviewUri(vscode.Uri.file(ext.iconFsPath)).toString();
      }
    }
    this.lastInventory = inventory;
    this.lastWorkspace = workspace;
    this.post({
      type: 'inventory',
      inventory,
      ...(workspace ? { workspace } : {}),
      icons,
    });
  }

  /**
   * Ensures inventory is fresh, then opens the cleanup (orphan-review) view — the same effect as
   * the webview's own "Review…" button, but invoked externally through the
   * `personas.reviewOrphans` command (extension.ts), which Home runs. No-op in the unsupported
   * terminal state, since there is nothing to review there.
   */
  async openCleanup(): Promise<void> {
    const services = this.services;
    if (!services) return;
    await this.enqueue(() =>
      this.guard(async () => {
        await this.refresh();
        await this.postOrphans(services);
      }),
    );
  }

  private async postOrphans(services: Services): Promise<void> {
    const inv = this.lastInventory ?? (await services.inventory.getInventory());
    const orphans = await buildOrphanInfos(inv, statFolder);
    this.post({ type: 'orphans', orphans });
  }

  private post(message: HostToMatrix): void {
    void this.panel.webview.postMessage(message);
  }

  private async onMessage(m: MatrixToHost): Promise<void> {
    const services = this.services;
    const actions = this.actions;
    if (!services || !actions) {
      // Terminal state (see showUnsupported): there are no services to act on, so every
      // message type is guarded out except 'ready', which (re-)announces the can't-manage
      // state instead of refreshing — this covers a fresh webview load and the narrow startup
      // race before the toolbar detaches (the webview's 'unsupported' handler removes it).
      if (m.type === 'ready') this.post({ type: 'unsupported', reason: this.unsupportedReason ?? '' });
      return;
    }
    switch (m.type) {
      case 'ready':
      case 'refresh':
        await this.guard(() => this.refresh());
        return;
      case 'toggleCell':
        await this.guard(() => actions.toggleCell(this.lastInventory, m.extId, m.profileId, m.install));
        return;
      case 'showApplyToAllProfilesGuide':
        await this.guard(() => this.showApplyToAllProfilesGuide(m.extId));
        return;
      case 'showWorkspaceEnablementGuide':
        await this.guard(() => this.showWorkspaceEnablementGuide(m.extId));
        return;
      case 'installInEveryProfile':
        await this.guard(() => actions.everyProfile(this.lastInventory, m.extId, 'install'));
        return;
      case 'removeFromEveryProfile':
        await this.guard(() => actions.everyProfile(this.lastInventory, m.extId, 'remove'));
        return;
      case 'openExtensionPage':
        await this.guard(() => this.openExtensionPage(m.extId));
        return;
      case 'requestOrphans':
        await this.guard(() => this.postOrphans(services));
        return;
      case 'cleanup':
        await this.guard(() => actions.cleanup(this.lastInventory, m.folderNames));
        return;
    }
  }

  /** Runs an action; on failure shows the error and re-syncs the UI from disk. */
  private async guard(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e) {
      const detail = asError(e).message;
      // Not awaited: a non-modal notification settles only when dismissed, and waiting on it would
      // hold up every message queued behind this one.
      void vscode.window.showErrorMessage(`Personas: ${detail}`, 'Copy Details').then((pick) => {
        if (pick === 'Copy Details') void vscode.env.clipboard.writeText(detail);
      });
      await this.refresh();
    }
  }

  /**
   * Guided fallback: focus the extension in the Extensions view; the user applies the native
   * "Apply Extension to all Profiles" context-menu action there. Spike B
   * (docs/spikes/findings.md): `workbench.extensions.action.toggleApplyToAllProfiles` needs VS
   * Code's internal IExtension view-model as its argument, which no public API provides.
   */
  private async showApplyToAllProfilesGuide(extId: string): Promise<void> {
    await vscode.commands.executeCommand('workbench.extensions.search', `@id:${extId}`);
    void vscode.window.showInformationMessage(
      'Right-click the extension in the Extensions view and choose "Apply Extension to all Profiles".',
    );
  }

  /**
   * Guided hand-off (ADR-0003): no official CLI persists workspace enablement (`code
   * --disable-extension` lasts one launch), so focus the extension in the Extensions view, where
   * VS Code's own "Enable (Workspace)" / "Disable (Workspace)" actions live.
   */
  private async showWorkspaceEnablementGuide(extId: string): Promise<void> {
    // Same defense-in-depth as openExtensionPage: only act on an id the last workspace
    // inventory offered the hand-off for — an unknown/stale id re-syncs instead.
    const status = this.lastWorkspace?.extensions.find((x) => x.id === extId);
    if (!status || !offersWorkspaceEnablementGuide(status)) {
      await this.refresh();
      return;
    }
    await vscode.commands.executeCommand('workbench.extensions.search', `@id:${extId}`);
    void vscode.window.showInformationMessage(
      'Use "Disable (Workspace)" or "Enable (Workspace)" on the extension in the Extensions view, then restart extensions when VS Code prompts.',
    );
  }

  /**
   * Opens VS Code's own extension page for `extId` — used by the hover card's name link.
   * Honest network note: VS Code's `extension.open` implementation queries its gallery service
   * as part of opening the page. Personas itself makes no network calls — the navigation is
   * user-initiated, and any Marketplace contact is VS Code's own, governed by VS Code's settings.
   */
  private async openExtensionPage(extId: string): Promise<void> {
    // Same defense-in-depth as MatrixActions: only act on ids present in the
    // last inventory the webview could have rendered — an unknown/stale id re-syncs instead.
    const ext = this.lastInventory?.extensions.find((x) => x.id === extId);
    if (!ext) {
      await this.refresh();
      return;
    }
    await vscode.commands.executeCommand('extension.open', extId);
  }

  private html(context: vscode.ExtensionContext): string {
    const w = this.panel.webview;
    const script = w.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'));
    const style = w.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.css'));
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
${renderContentSecurityPolicyMeta(matrixContentSecurityPolicy(w.cspSource, nonce))}
<link rel="stylesheet" href="${style}">
<title>Extension Matrix</title>
</head>
<body>
<div id="app">Loading…</div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
