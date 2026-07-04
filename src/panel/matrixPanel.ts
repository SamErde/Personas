import * as vscode from 'vscode';
import { buildOrphanInfos, CleanupService } from '../core/cleanup';
import { directInstallProfileIds, type InventoryService } from '../core/inventory';
import { MutationError, type MutationService } from '../core/mutations';
import type { HostToWebview, Inventory, WebviewToHost } from '../core/types';

// Spike B verdict (docs/spikes/findings.md): TOGGLE_SUPPORTED = no. The command
// `workbench.extensions.action.toggleApplyToAllProfiles` exists but requires VS Code's
// internal IExtension workbench view-model as its argument (not obtainable via any public
// API) — every public-API shape tried (string id, {id}, array, and the real vscode.Extension
// object) crashes inside the handler. Not invocable with public args; keep undefined and
// offer the guided fallback in toggleAllProfiles below instead.
const TOGGLE_ALL_PROFILES_COMMAND: string | undefined = undefined;

export class MatrixPanel {
  static current: MatrixPanel | undefined;

  static show(
    context: vscode.ExtensionContext,
    services: { inventory: InventoryService; mutations: MutationService; cleanup: CleanupService },
  ): void {
    if (MatrixPanel.current) {
      MatrixPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('visexMatrix', 'Extension Matrix', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    });
    MatrixPanel.current = new MatrixPanel(panel, context, services);
  }

  private lastInventory: Inventory | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly services: {
      inventory: InventoryService;
      mutations: MutationService;
      cleanup: CleanupService;
    },
  ) {
    panel.webview.html = this.html(context);
    panel.onDidDispose(() => (MatrixPanel.current = undefined));
    panel.webview.onDidReceiveMessage((m: WebviewToHost) => void this.onMessage(m));
  }

  async refresh(): Promise<void> {
    this.lastInventory = await this.services.inventory.getInventory();
    this.post({
      type: 'inventory',
      inventory: this.lastInventory,
      toggleSupported: TOGGLE_ALL_PROFILES_COMMAND !== undefined,
    });
  }

  private post(message: HostToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private async onMessage(m: WebviewToHost): Promise<void> {
    switch (m.type) {
      case 'ready':
      case 'refresh':
        await this.guard(() => this.refresh());
        return;
      case 'toggleCell':
        await this.guard(() => this.toggleCell(m.extId, m.profileId, m.install));
        return;
      case 'toggleAllProfiles':
        await this.guard(() => this.toggleAllProfiles(m.extId));
        return;
      case 'requestOrphans':
        await this.guard(async () => {
          const inv = this.lastInventory ?? (await this.services.inventory.getInventory());
          const orphans = await buildOrphanInfos(inv, statFolder);
          this.post({ type: 'orphans', orphans });
        });
        return;
      case 'cleanup':
        await this.guard(() => this.cleanup(m.folderNames));
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

  private async toggleCell(extId: string, profileId: string, install: boolean): Promise<void> {
    const inv = this.lastInventory;
    if (!inv) return;
    const profile = inv.profiles.find((p) => p.id === profileId);
    const ext = inv.extensions.find((x) => x.id === extId);
    if (!profile || !ext || profile.inheritsDefaultExtensions) return;

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
        const inheritingProfiles = profile.isDefault
          ? inv.profiles.filter((p) => p.inheritsDefaultExtensions)
          : [];
        const inheritWarning =
          inheritingProfiles.length > 0
            ? ` Profiles that inherit the Default profile's extensions (${inheritingProfiles.map((p) => p.name).join(', ')}) will also lose it.`
            : '';
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
    if (install) await this.services.mutations.install(extId, profileName);
    else await this.services.mutations.uninstall(extId, profileName);
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

  private async cleanup(folderNames: string[]): Promise<void> {
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
    const results = await this.services.cleanup.deleteFolders(targets);
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
  content="default-src 'none'; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
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

async function statFolder(fsPath: string): Promise<{ sizeBytes: number; lastModifiedMs: number }> {
  const { readdir, stat } = await import('node:fs/promises');
  const path = await import('node:path');
  let total = 0;
  let newest = 0;

  // One unreadable directory must not abort the whole orphan listing — skip it and keep walking.
  async function tryReaddir(dir: string) {
    try {
      return await readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
  }

  async function walk(dir: string): Promise<void> {
    const entries = await tryReaddir(dir);
    if (!entries) return;
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
      } else {
        // One unreadable/removed file (e.g. a race with deletion) must not abort the walk —
        // skip it and keep totals best-effort.
        try {
          const s = await stat(p);
          total += s.size;
          if (s.mtimeMs > newest) newest = s.mtimeMs;
        } catch {
          // skip
        }
      }
    }
  }
  await walk(fsPath);
  return { sizeBytes: total, lastModifiedMs: newest };
}
