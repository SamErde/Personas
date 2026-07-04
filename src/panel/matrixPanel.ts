import * as vscode from 'vscode';
import { buildOrphanInfos } from '../core/cleanup';
import { directInstallProfileIds, installEverywhereTargets, removeEverywhereTargets } from '../core/inventory';
import { MutationError } from '../core/mutations';
import type { HostToWebview, Inventory, WebviewToHost } from '../core/types';
import type { Services } from '../servicesFactory';
import { statFolder } from './fsStat';

// Spike B verdict (docs/spikes/findings.md): TOGGLE_SUPPORTED = no. The command
// `workbench.extensions.action.toggleApplyToAllProfiles` exists but requires VS Code's
// internal IExtension workbench view-model as its argument (not obtainable via any public
// API) — every public-API shape tried (string id, {id}, array, and the real vscode.Extension
// object) crashes inside the handler. Not invocable with public args; keep undefined and
// offer the guided fallback in toggleAllProfiles below instead.
const TOGGLE_ALL_PROFILES_COMMAND: string | undefined = undefined;

export class MatrixPanel {
  static current: MatrixPanel | undefined;

  static show(context: vscode.ExtensionContext, services: Services): void {
    if (MatrixPanel.current) {
      MatrixPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'profileExtensionManager.matrix',
      'Profile Extension Matrix',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
          vscode.Uri.file(services.paths.extensionsDir),
        ],
      },
    );
    MatrixPanel.current = new MatrixPanel(panel, context, services, undefined);
  }

  /**
   * Opens the panel in the terminal "can't manage profiles here" state instead of the matrix.
   * Per the design spec's error-handling class 1, the panel must never be a blank screen even
   * when the environment is unsupported — the webview renders `reason` once it signals ready.
   * Mirrors `show`'s reveal-if-already-open behavior.
   */
  static showUnsupported(context: vscode.ExtensionContext, reason: string): void {
    if (MatrixPanel.current) {
      MatrixPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'profileExtensionManager.matrix',
      'Profile Extension Matrix',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      },
    );
    MatrixPanel.current = new MatrixPanel(panel, context, undefined, reason);
  }

  private lastInventory: Inventory | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly services: Services | undefined,
    /** Set only by `showUnsupported`. When defined, the panel is permanently in the terminal
     *  can't-manage state and every mutating message is guarded out in `onMessage`. */
    private readonly unsupportedReason: string | undefined,
  ) {
    panel.webview.html = this.html(context);
    panel.onDidDispose(() => (MatrixPanel.current = undefined));
    panel.webview.onDidReceiveMessage((m: WebviewToHost) => void this.onMessage(m));
  }

  async refresh(): Promise<void> {
    if (!this.services) return; // unsupported mode — nothing to read; see onMessage's guard.
    this.lastInventory = await this.services.inventory.getInventory();
    const icons: Record<string, string> = {};
    for (const ext of this.lastInventory.extensions) {
      if (ext.iconFsPath) {
        icons[ext.id] = this.panel.webview.asWebviewUri(vscode.Uri.file(ext.iconFsPath)).toString();
      }
    }
    this.post({
      type: 'inventory',
      inventory: this.lastInventory,
      toggleSupported: TOGGLE_ALL_PROFILES_COMMAND !== undefined,
      icons,
    });
  }

  /**
   * Ensures inventory is fresh, then opens the cleanup (orphan-review) view — the same effect as
   * the webview's own "Review…" button, but invoked externally (the sidebar dashboard calls this
   * after asking the host to show the matrix). No-op in the unsupported terminal state, since
   * there is nothing to review there.
   */
  async openCleanup(): Promise<void> {
    const services = this.services;
    if (!services) return;
    await this.guard(async () => {
      await this.refresh();
      await this.postOrphans(services);
    });
  }

  private async postOrphans(services: Services): Promise<void> {
    const inv = this.lastInventory ?? (await services.inventory.getInventory());
    const orphans = await buildOrphanInfos(inv, statFolder);
    this.post({ type: 'orphans', orphans });
  }

  private post(message: HostToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private async onMessage(m: WebviewToHost): Promise<void> {
    const services = this.services;
    if (!services) {
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
        await this.guard(() => this.toggleCell(services, m.extId, m.profileId, m.install));
        return;
      case 'toggleAllProfiles':
        await this.guard(() => this.toggleAllProfiles(m.extId));
        return;
      case 'installEverywhere':
        await this.guard(() => this.installEverywhere(services, m.extId));
        return;
      case 'removeEverywhere':
        await this.guard(() => this.removeEverywhere(services, m.extId));
        return;
      case 'openExtensionPage':
        await this.guard(() => this.openExtensionPage(m.extId));
        return;
      case 'requestOrphans':
        await this.guard(() => this.postOrphans(services));
        return;
      case 'cleanup':
        await this.guard(() => this.cleanup(services, m.folderNames));
        return;
    }
  }

  /** Runs an action; on failure shows the error and re-syncs the UI from disk. */
  private async guard(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e) {
      const detail = e instanceof MutationError ? e.message : e instanceof Error ? e.message : String(e);
      const pick = await vscode.window.showErrorMessage(`Profile Extension Manager: ${detail}`, 'Copy Details');
      if (pick === 'Copy Details') await vscode.env.clipboard.writeText(detail);
      await this.refresh();
    }
  }

  /**
   * Sentence appended to uninstall confirmations when the Default profile is affected and other
   * profiles inherit its extensions — they lose the extension too. Empty when not applicable.
   */
  private cascadeWarning(inv: Inventory, defaultIsAffected: boolean): string {
    const inheritingProfiles = defaultIsAffected ? inv.profiles.filter((p) => p.inheritsDefaultExtensions) : [];
    return inheritingProfiles.length > 0
      ? ` Profiles that inherit the Default profile's extensions (${inheritingProfiles.map((p) => p.name).join(', ')}) will also lose it.`
      : '';
  }

  private async toggleCell(services: Services, extId: string, profileId: string, install: boolean): Promise<void> {
    // The webview marks the clicked cell as locally pending the moment the user acts, and only a
    // fresh 'inventory' push clears that state — so every exit path from a mutation handler,
    // including these stale/no-op bails, must refresh rather than silently return (same pattern
    // as the stale-click re-sync below).
    const inv = this.lastInventory;
    if (!inv) {
      await this.refresh();
      return;
    }
    const profile = inv.profiles.find((p) => p.id === profileId);
    const ext = inv.extensions.find((x) => x.id === extId);
    if (!profile || !ext || profile.inheritsDefaultExtensions) {
      await this.refresh();
      return;
    }

    if (!install) {
      // Stale click: the cell no longer reflects reality (e.g. a watcher-driven refresh
      // already removed it from this profile). Re-sync instead of acting on stale state.
      if (!ext.installedIn.includes(profileId)) {
        await this.refresh();
        return;
      }

      // installedIn includes profiles that merely inherit the default profile's extensions, so
      // it overcounts "how many profiles would lose this extension if uninstalled here" — use
      // direct installs only to detect the true last-profile case.
      const direct = directInstallProfileIds(inv, extId);
      if (direct.length === 1 && direct[0] === profileId) {
        const inheritWarning = this.cascadeWarning(inv, profile.isDefault);
        const pick = await vscode.window.showWarningMessage(
          `"${ext.displayName}" is installed only in the "${profile.name}" profile. Uninstall it from your last profile?${inheritWarning}`,
          { modal: true },
          'Uninstall',
        );
        if (pick !== 'Uninstall') {
          await this.refresh(); // revert the pending cell
          return;
        }
      }
    }

    this.post({ type: 'pending', extId, profileId });
    const profileName = profile.isDefault ? undefined : profile.name;
    if (install) await services.mutations.install(extId, profileName);
    else await services.mutations.uninstall(extId, profileName);
    await this.refresh();
  }

  private async toggleAllProfiles(extId: string): Promise<void> {
    if (TOGGLE_ALL_PROFILES_COMMAND !== undefined) {
      await vscode.commands.executeCommand(TOGGLE_ALL_PROFILES_COMMAND, extId);
      await this.refresh();
      return;
    }
    // Guided fallback: focus the extension in the Extensions view; user applies the
    // native "Apply Extension to all Profiles" context-menu action there.
    await vscode.commands.executeCommand('workbench.extensions.search', `@id:${extId}`);
    void vscode.window.showInformationMessage(
      'Right-click the extension in the Extensions view and choose "Apply Extension to all Profiles".',
    );
  }

  private async installEverywhere(services: Services, extId: string): Promise<void> {
    const inv = this.lastInventory;
    const ext = inv?.extensions.find((x) => x.id === extId);
    if (!inv || !ext) {
      // Stale/unknown id: the webview's bulk button is already locally pending — push a fresh
      // inventory so that state clears instead of spinning forever.
      await this.refresh();
      return;
    }

    const targets = installEverywhereTargets(inv, extId);
    if (targets.length === 0) {
      await vscode.window.showInformationMessage('Already installed in every profile.');
      await this.refresh();
      return;
    }

    const pick = await vscode.window.showWarningMessage(
      `Install "${ext.displayName}" into ${targets.length} profile(s)?\n\n${targets.map((p) => p.name).join('\n')}`,
      { modal: true },
      'Install',
    );
    if (pick !== 'Install') {
      await this.refresh(); // revert any pending UI state
      return;
    }

    for (const p of targets) this.post({ type: 'pending', extId, profileId: p.id });
    // Sequential and awaited so a mid-loop failure (propagated by guard()) stops remaining
    // installs instead of racing ahead — the MutationService queue already serializes the CLI
    // calls themselves, this loop controls the higher-level stop-on-error behavior.
    for (const p of targets) {
      const profileName = p.isDefault ? undefined : p.name;
      await services.mutations.install(extId, profileName);
    }
    await this.refresh();
  }

  private async removeEverywhere(services: Services, extId: string): Promise<void> {
    const inv = this.lastInventory;
    const ext = inv?.extensions.find((x) => x.id === extId);
    if (!inv || !ext) {
      // Same stale-id handling as installEverywhere: refresh so the webview's local pending
      // state (set on click) is cleared by the resulting 'inventory' push.
      await this.refresh();
      return;
    }

    const targets = removeEverywhereTargets(inv, extId);
    if (targets.length === 0) {
      await vscode.window.showInformationMessage('Not directly installed in any profile.');
      await this.refresh();
      return;
    }

    // Always warn like the last-profile path in toggleCell, appending the cascade sentence
    // whenever the default profile is a target and other profiles inherit its extensions.
    const cascadeWarning = this.cascadeWarning(
      inv,
      targets.some((p) => p.isDefault),
    );

    const pick = await vscode.window.showWarningMessage(
      `Remove "${ext.displayName}" from ${targets.length} profile(s)?\n\n${targets.map((p) => p.name).join('\n')}${cascadeWarning}`,
      { modal: true },
      'Remove',
    );
    if (pick !== 'Remove') {
      await this.refresh(); // revert any pending UI state
      return;
    }

    for (const p of targets) this.post({ type: 'pending', extId, profileId: p.id });
    for (const p of targets) {
      const profileName = p.isDefault ? undefined : p.name;
      await services.mutations.uninstall(extId, profileName);
    }
    await this.refresh();
  }

  /**
   * Opens VS Code's own extension page for `extId` — used by the hover card's name link.
   * Honest network note: VS Code's `extension.open` implementation queries its gallery service
   * as part of opening the page. PEM itself makes no network calls — the navigation is
   * user-initiated, and any Marketplace contact is VS Code's own, governed by VS Code's settings.
   */
  private async openExtensionPage(extId: string): Promise<void> {
    // Same defense-in-depth as toggleCell/installEverywhere: only act on ids present in the
    // last inventory the webview could have rendered — an unknown/stale id re-syncs instead.
    const ext = this.lastInventory?.extensions.find((x) => x.id === extId);
    if (!ext) {
      await this.refresh();
      return;
    }
    await vscode.commands.executeCommand('extension.open', extId);
  }

  private async cleanup(services: Services, folderNames: string[]): Promise<void> {
    const inv = this.lastInventory;
    if (!inv || folderNames.length === 0) return;
    // Defense in depth: only ever target folders belonging to orphaned extensions, even
    // though the webview is only ever expected to request orphan folder names in the first
    // place — deleteFolders itself performs no orphan verification.
    const orphanedVersions = inv.extensions.filter((e) => e.orphaned).flatMap((e) => e.versions);
    const targets = orphanedVersions.filter((v) => folderNames.includes(v.folderName));
    const pick = await vscode.window.showWarningMessage(
      `Move ${targets.length} extension folder(s) to the Recycle Bin/Trash?\n\n${targets.map((t) => t.folderName).join('\n')}`,
      { modal: true },
      'Move to Trash',
    );
    if (pick !== 'Move to Trash') {
      await this.refresh(); // revert any pending UI state
      return;
    }
    const results = await services.cleanup.deleteFolders(targets);
    this.post({ type: 'cleanupResult', results });
    await this.refresh();
  }

  private html(context: vscode.ExtensionContext): string {
    const w = this.panel.webview;
    const script = w.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'));
    const style = w.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.css'));
    const nonce = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${w.cspSource}; script-src 'nonce-${nonce}'; img-src ${w.cspSource};">
<link rel="stylesheet" href="${style}">
<title>Profile Extension Matrix</title>
</head>
<body>
<div id="app">Loading…</div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
