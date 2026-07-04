import * as vscode from 'vscode';
import { CleanupService } from './core/cleanup';
import { InventoryService, type InventoryIo } from './core/inventory';
import { createNodeCliRunner, MutationService } from './core/mutations';
import { findCli, resolvePaths, type Platform, type ResolvedPaths } from './core/paths';
import { MatrixPanel } from './panel/matrixPanel';
import { WelcomeViewProvider } from './panel/welcomeView';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('profileExtensionManager.welcome', new WelcomeViewProvider(context)),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('profileExtensionManager.showMatrix', async () => {
      const setup = await buildServices(context);
      if ('error' in setup) {
        // Primary cue: the panel itself renders the can't-manage state (never a blank screen).
        MatrixPanel.showUnsupported(context, setup.error);
        // Secondary cue: a toast, kept for users who miss/close the panel.
        void vscode.window.showErrorMessage(
          `Profile Extension Manager can't manage profiles in this environment: ${setup.error}`,
        );
        return;
      }
      MatrixPanel.show(context, setup);
      await MatrixPanel.current?.refresh();
      watchForChanges(context, setup.watched);
    }),
  );
}

export function deactivate(): void {}

type Services = {
  inventory: InventoryService;
  mutations: MutationService;
  cleanup: CleanupService;
  paths: ResolvedPaths;
  watched: string[];
};

async function buildServices(context: vscode.ExtensionContext): Promise<Services | { error: string }> {
  // In a dev host (F5), context.extensionUri is the source folder, not an installed extension,
  // so the derived extensions pool resolves to the repo's parent directory — one toggle would
  // run mutations against the developer's real user-data dir under the Spike C silent-hybrid
  // failure mode (docs/spikes/findings.md), not a sandbox. Guard it out; PEM_DEV_ALLOW=1 is the
  // deliberate escape hatch for intentional dev-host testing.
  if (context.extensionMode !== vscode.ExtensionMode.Production && process.env['PEM_DEV_ALLOW'] !== '1') {
    return {
      error:
        'running in a development host — Profile Extension Manager manages the install it runs in; run from an installed build.',
    };
  }
  if (vscode.env.remoteName !== undefined) return { error: 'remote workspaces are not supported.' };

  const fs = await import('node:fs');
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');

  const paths = resolvePaths({
    globalStorageFsPath: context.globalStorageUri.fsPath,
    extensionFsPath: context.extensionUri.fsPath,
    platform: process.platform as Platform,
  });
  if (!fs.existsSync(paths.storageJson)) {
    return { error: `profile registry not found at ${paths.storageJson}.` };
  }
  const cliPath = findCli(vscode.env.appRoot, process.platform as Platform, (p) => fs.existsSync(p));
  if (!cliPath) return { error: `the "code" CLI was not found near ${vscode.env.appRoot}.` };

  const io: InventoryIo = {
    readFile: async (p) => {
      try {
        return await fsp.readFile(p, 'utf8');
      } catch (e) {
        // ENOENT (does not exist) degrades to the usual "missing file" handling. Any other
        // error (EPERM/EACCES on a locked storage.json or global extensions.json, etc.) must
        // not be conflated with "missing" — that would silently disable orphan suppression for
        // data InventoryService can no longer see, the exact false-orphan class the inventory
        // design guards against. Surface it as an Error so getInventory degrades it like a
        // parse failure instead.
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        return e instanceof Error ? e : new Error(String(e));
      }
    },
    listDirs: async (p) => {
      try {
        return (await fsp.readdir(p, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
      } catch {
        return [];
      }
    },
    readPackageMeta: async (folder) => {
      try {
        const pkg = JSON.parse(await fsp.readFile(path.join(folder, 'package.json'), 'utf8')) as {
          displayName?: unknown;
          icon?: unknown;
        };
        const displayName =
          typeof pkg.displayName === 'string' && !pkg.displayName.startsWith('%') ? pkg.displayName : undefined;
        const icon = typeof pkg.icon === 'string' ? pkg.icon : undefined;
        return { displayName, icon };
      } catch {
        return undefined;
      }
    },
  };

  const inventory = new InventoryService(paths, io);
  const mutations = new MutationService({
    cliPath,
    extraArgs: ['--user-data-dir', paths.userDataDir, '--extensions-dir', paths.extensionsDir],
    run: createNodeCliRunner(),
  });
  const cleanup = new CleanupService((fsPath) =>
    Promise.resolve(vscode.workspace.fs.delete(vscode.Uri.file(fsPath), { recursive: true, useTrash: true })),
  );
  return { inventory, mutations, cleanup, paths, watched: inventory.watchedFiles() };
}

const watchedDirs = new Set<string>();
let watchTimer: NodeJS.Timeout | undefined;
function scheduleRefresh(): void {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => void MatrixPanel.current?.refresh(), 300);
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
