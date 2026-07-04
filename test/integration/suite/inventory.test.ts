import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { InventoryService, type InventoryIo } from '../../../src/core/inventory';
import { createNodeCliRunner, MutationService } from '../../../src/core/mutations';
import { findCli, type Platform, type ResolvedPaths } from '../../../src/core/paths';

const SUITE_TIMEOUT_MS = 120000;

const userDataDir = process.env['VISEX_IT_USER_DATA'] as string;
const extensionsDir = process.env['VISEX_IT_EXT_DIR'] as string;
// Packaged by runTests.ts (the plain launcher process, not this sandboxed extension host —
// spawning vsce's cmd.exe shim from inside the Extension Development Host fails with ENOENT).
const vsixPath = process.env['VISEX_IT_VSIX_PATH'] as string;

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
  describe('Visex end-to-end against a sandboxed VS Code', { timeout: SUITE_TIMEOUT_MS }, () => {
    it('reads an inventory with the default profile from a fresh sandbox', guard(async () => {
      const inventory = await new InventoryService(testPaths(), io).getInventory();
      assert.ok(inventory.profiles.some((p) => p.isDefault));
      assert.deepStrictEqual(inventory.warnings, []);
    }));

    it('CLI install into default profile appears in inventory; uninstall removes it', guard(async () => {
      const cliPath = findCli(vscode.env.appRoot, process.platform as Platform, (p) => fs.existsSync(p));
      assert.ok(cliPath, 'CLI not found from appRoot');
      const mutations = new MutationService({
        cliPath,
        extraArgs: ['--user-data-dir', userDataDir, '--extensions-dir', extensionsDir],
        run: createNodeCliRunner(),
      });

      await mutations.install(vsixPath); // CLI accepts a .vsix path for --install-extension
      let inventory = await new InventoryService(testPaths(), io).getInventory();
      const installed = inventory.extensions.find((e) => e.id === 'visex-tests.visex-hello-fixture');
      assert.ok(installed, 'fixture not found in inventory after install');
      assert.deepStrictEqual(installed.installedIn, ['default']);

      await mutations.uninstall('visex-tests.visex-hello-fixture');
      inventory = await new InventoryService(testPaths(), io).getInventory();
      const remaining = inventory.extensions.find(
        (e) => e.id === 'visex-tests.visex-hello-fixture' && e.installedIn.length > 0,
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
