import * as vscode from 'vscode';
import { CleanupService } from './core/cleanup';
import { InventoryService, type InventoryIo } from './core/inventory';
import { createNodeCliRunner, MutationService } from './core/mutations';
import { findCli, resolvePaths, type Platform, type ResolvedPaths } from './core/paths';

export type Services = {
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
  // failure mode (docs/spikes/findings.md), not a sandbox. Guard it out; PERSONAS_DEV_ALLOW=1 is the
  // deliberate escape hatch for intentional dev-host testing.
  if (context.extensionMode !== vscode.ExtensionMode.Production && process.env['PERSONAS_DEV_ALLOW'] !== '1') {
    return {
      error:
        'running in a development host — Personas manages the install it runs in; run from an installed build.',
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
          description?: unknown;
          publisher?: unknown;
        };
        const displayName =
          typeof pkg.displayName === 'string' && !pkg.displayName.startsWith('%') ? pkg.displayName : undefined;
        const icon = typeof pkg.icon === 'string' ? pkg.icon : undefined;
        const description =
          typeof pkg.description === 'string' && !pkg.description.startsWith('%') ? pkg.description : undefined;
        const publisher = typeof pkg.publisher === 'string' ? pkg.publisher : undefined;
        return { displayName, icon, description, publisher };
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

let servicesPromise: Promise<Services | { error: string }> | undefined;
let onFirstBuild: ((context: vscode.ExtensionContext, services: Services) => void) | undefined;

/**
 * Registers the hook run exactly once, when services are first built successfully. extension.ts
 * uses it to start the file watchers that drive live refresh (matrix, sidebar dashboard, open
 * personas-readonly documents) — tied to service construction rather than the showMatrix command, so
 * the sidebar-only path (welcome view resolve, with openMatrixOnActivityBarClick disabled) gets
 * watchers too. Lives here as a hook, not a direct call, because servicesFactory importing
 * extension.ts would be circular. Never invoked on the unsupported-environment error path.
 */
export function setOnServicesBuilt(hook: (context: vscode.ExtensionContext, services: Services) => void): void {
  onFirstBuild = hook;
}

/**
 * Builds the extension's core services once per process lifetime and caches the result (including
 * a failure) — paths/CLI resolution never changes for the life of the host, so rebuilding on every
 * call would redo the dev-host guard and CLI probe for no reason. Shared by the showMatrix command
 * and the sidebar dashboard so both act on the same services without duplicating construction.
 */
export function getOrBuildServices(context: vscode.ExtensionContext): Promise<Services | { error: string }> {
  if (!servicesPromise) {
    servicesPromise = buildServices(context).then((result) => {
      // The promise is cached, so this then-branch (and thus the hook) runs at most once.
      if (!('error' in result)) onFirstBuild?.(context, result);
      return result;
    });
  }
  return servicesPromise;
}
