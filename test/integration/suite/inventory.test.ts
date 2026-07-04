import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { InventoryService, type InventoryIo } from '../../../src/core/inventory';
import { createNodeCliRunner, MutationService } from '../../../src/core/mutations';
import { findCli, type Platform, type ResolvedPaths } from '../../../src/core/paths';

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
  readDisplayName: async () => undefined,
};

describe('Visex end-to-end against a sandboxed VS Code', () => {
  it('reads an inventory with the default profile from a fresh sandbox', async () => {
    const inventory = await new InventoryService(testPaths(), io).getInventory();
    assert.ok(inventory.profiles.some((p) => p.isDefault));
    assert.deepStrictEqual(inventory.warnings, []);
  });

  it('CLI install into default profile appears in inventory; uninstall removes it', async function () {
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
    const after = inventory.extensions.find(
      (e) => e.id === 'visex-tests.visex-hello-fixture' && e.installedIn.length > 0,
    );
    assert.strictEqual(after, undefined);
  });
});
