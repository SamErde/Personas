import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { InventoryService, type InventoryIo } from '../../../src/core/inventory';
import { createNodeCliRunner, MutationService } from '../../../src/core/mutations';
import { findCli, type Platform, type ResolvedPaths } from '../../../src/core/paths';
import {
  WorkspaceInventoryService,
  createWorkspaceDescriptor,
  type WorkspaceInventoryIo,
} from '../../../src/core/workspace';

const SUITE_TIMEOUT_MS = 120000;

const userDataDir = process.env['PERSONAS_IT_USER_DATA'] as string;
const extensionsDir = process.env['PERSONAS_IT_EXT_DIR'] as string;
// Packaged by runTests.ts (the plain launcher process, not this sandboxed extension host —
// spawning vsce's cmd.exe shim from inside the Extension Development Host fails with ENOENT).
const vsixPath = process.env['PERSONAS_IT_VSIX_PATH'] as string;
const workspaceDir = process.env['PERSONAS_IT_WORKSPACE'] as string;

function testPaths(): ResolvedPaths {
  const userDir = path.join(userDataDir, 'User');
  return {
    userDataDir,
    userDir,
    storageJson: path.join(userDir, 'globalStorage', 'storage.json'),
    profilesDir: path.join(userDir, 'profiles'),
    extensionsDir,
    globalExtensionsJson: path.join(extensionsDir, 'extensions.json'),
    obsoleteFile: path.join(extensionsDir, '.obsolete'),
  };
}

const io: InventoryIo = {
  readFile: async (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  },
  listDirs: async (p) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  },
  readPackageMeta: async () => undefined,
};

const workspaceIo: WorkspaceInventoryIo = {
  readFile: async (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      return error instanceof Error ? error : new Error(String(error));
    }
  },
  listEntries: async (p) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      return error instanceof Error ? error : new Error(String(error));
    }
  },
  getDescriptor: () =>
    createWorkspaceDescriptor({
      name: vscode.workspace.name,
      workspaceFileUri: vscode.workspace.workspaceFile?.toString(),
      ...(vscode.workspace.workspaceFile?.scheme === 'file'
        ? { workspaceFileFsPath: vscode.workspace.workspaceFile.fsPath }
        : {}),
      folders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        name: folder.name,
        uri: folder.uri.toString(),
        scheme: folder.uri.scheme,
        ...(folder.uri.scheme === 'file' ? { fsPath: folder.uri.fsPath } : {}),
      })),
    }),
  getRuntimeExtensions: () =>
    vscode.extensions.all.map((extension) => ({
      id: extension.id,
      uri: extension.extensionUri.toString(),
      ...(extension.extensionUri.scheme === 'file' ? { fsPath: extension.extensionUri.fsPath } : {}),
    })),
};

let suiteFailed = false;

// node:test never rejects a test()/it() promise on assertion failure or timeout (failures are
// only ever surfaced through its reporter and `process.exitCode`, both of which settle too late
// to observe here — see index.ts for why this suite runs in-process instead of via `run()`).
// This wrapper independently tracks pass/fail, including a manual timeout race so a hang is
// caught the same way an assertion failure is, so `done` below reflects the real outcome.
function guard(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await withTimeout(fn(), SUITE_TIMEOUT_MS);
    } catch (err) {
      suiteFailed = true;
      console.error(err);
      throw err;
    }
  };
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`test exceeded ${ms}ms timeout`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Resolves once every test in the suite has run, with `true` if any of them failed. */
export const done: Promise<boolean> = new Promise((resolveDone) => {
  describe('Personas end-to-end against a sandboxed VS Code', { timeout: SUITE_TIMEOUT_MS }, () => {
    it('reads an inventory with the default profile from a fresh sandbox', guard(async () => {
      const inventory = await new InventoryService(testPaths(), io).getInventory();
      assert.ok(inventory.profiles.some((p) => p.isDefault));
      assert.deepStrictEqual(inventory.warnings, []);
      assert.strictEqual(vscode.workspace.workspaceFolders?.length, 1);
      assert.strictEqual(
        comparableFsPath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''),
        comparableFsPath(workspaceDir),
      );

      const workspace = await new WorkspaceInventoryService(testPaths().storageJson, workspaceIo).getWorkspaceInventory(
        inventory,
      );
      assert.ok(workspace, 'workspace inventory missing for disposable folder fixture');
      const candidate = workspace.extensions.find((extension) => extension.id === 'personas-tests.workspace-candidate');
      assert.ok(candidate, 'workspace-local candidate fixture was not discovered');
      assert.strictEqual(candidate.state, 'unknown');
      assert.strictEqual(candidate.workspaceLocal, 'candidate');
      assert.strictEqual(candidate.profileBacked, false);
    }));

    it('CLI changes fire the stable event and the installed fixture becomes positively enabled', guard(async () => {
      const cliPath = findCli(vscode.env.appRoot, process.platform as Platform, (p) => fs.existsSync(p));
      assert.ok(cliPath, 'CLI not found from appRoot');
      const mutations = new MutationService({
        cliPath,
        extraArgs: ['--user-data-dir', userDataDir, '--extensions-dir', extensionsDir],
        run: createNodeCliRunner(),
      });

      const installedEvent = nextExtensionsChange();
      await mutations.install(vsixPath); // CLI accepts a .vsix path for --install-extension
      await installedEvent;
      await waitFor(
        () => vscode.extensions.all.some((extension) => extension.id === 'personas-tests.personas-hello-fixture'),
        'installed fixture did not enter vscode.extensions.all',
      );
      let inventory = await new InventoryService(testPaths(), io).getInventory();
      const installed = inventory.extensions.find((e) => e.id === 'personas-tests.personas-hello-fixture');
      assert.ok(installed, 'fixture not found in inventory after install');
      assert.deepStrictEqual(installed.installedIn, ['default']);

      const workspace = await new WorkspaceInventoryService(testPaths().storageJson, workspaceIo).getWorkspaceInventory(
        inventory,
      );
      const effective = workspace?.extensions.find(
        (extension) => extension.id === 'personas-tests.personas-hello-fixture',
      );
      assert.ok(effective, 'installed fixture missing from workspace snapshot');
      assert.strictEqual(effective.state, 'enabled');
      assert.ok(effective.runtimeUri, 'enabled fixture did not retain public runtime URI evidence');

      const uninstalledEvent = nextExtensionsChange();
      await mutations.uninstall('personas-tests.personas-hello-fixture');
      await uninstalledEvent;
      await waitFor(
        () => !vscode.extensions.all.some((extension) => extension.id === 'personas-tests.personas-hello-fixture'),
        'uninstalled fixture remained in vscode.extensions.all',
      );
      inventory = await new InventoryService(testPaths(), io).getInventory();
      const remaining = inventory.extensions.find(
        (e) => e.id === 'personas-tests.personas-hello-fixture' && e.installedIn.length > 0,
      );
      assert.strictEqual(remaining, undefined);
    }));

    after(async () => {
      // Give the default reporter's still-pending stdout writes (e.g. this test's own pass/fail
      // line and the final summary) a chance to flush before index.ts's run() resolves and
      // @vscode/test-electron tears the host down — otherwise the last chunk can be lost.
      await new Promise((r) => setTimeout(r, 100));
      resolveDone(suiteFailed);
    });
  });
});

function nextExtensionsChange(): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve) => {
      const disposable = vscode.extensions.onDidChange(() => {
        disposable.dispose();
        resolve();
      });
    }),
    30_000,
  );
}

async function waitFor(predicate: () => boolean, failureMessage: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(failureMessage);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function comparableFsPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
