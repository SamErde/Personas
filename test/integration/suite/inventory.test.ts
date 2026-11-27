import { PowerShellController } from '../../../src/panel/powerShellController';
import { PowerShellService } from '../../../src/powershell/service';
import { deleteProfile } from '../../../src/powershell/files';
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import * as vscode from 'vscode';
import { InventoryService, type InventoryIo } from '../../../src/core/inventory';
import { createCliRunner } from '../../../src/core/cliRunner';
import { withoutRepositoryOverrides } from '../../../src/git/configService';
import { MutationService } from '../../../src/core/mutations';
import { packageNlsLocaleFileNames, readLocalizedPackageMeta } from '../../../src/core/packageNls';
import { findCli, type Platform, type ResolvedPaths } from '../../../src/core/paths';
import {
  WorkspaceInventoryService,
  createWorkspaceDescriptor,
  type WorkspaceInventoryIo,
} from '../../../src/core/workspace';
import { readBoundedWorkspaceFile } from '../../../src/workspaceFileIo';

const SUITE_TIMEOUT_MS = 120000;

const userDataDir = process.env['PERSONAS_IT_USER_DATA'] as string;
const extensionsDir = process.env['PERSONAS_IT_EXT_DIR'] as string;
// Packaged by runTests.ts (the plain launcher process, not this sandboxed extension host —
// spawning vsce's cmd.exe shim from inside the Extension Development Host fails with ENOENT).
const vsixPath = process.env['PERSONAS_IT_VSIX_PATH'] as string;
const workspaceDir = process.env['PERSONAS_IT_WORKSPACE'] as string;
const inventoryReadCounts = new Map<string, number>();

async function readInventoryFile(filePath: string): Promise<string | undefined> {
  inventoryReadCounts.set(filePath, (inventoryReadCounts.get(filePath) ?? 0) + 1);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function writeInstalledFixture(folderName: string, displayName: string, nls?: string): string {
  const folder = path.join(extensionsDir, folderName);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'package.json'),
    JSON.stringify({
      name: folderName.slice(folderName.indexOf('.') + 1, folderName.lastIndexOf('-')),
      publisher: folderName.slice(0, folderName.indexOf('.')),
      version: folderName.slice(folderName.lastIndexOf('-') + 1),
      displayName,
    }),
  );
  if (nls !== undefined) fs.writeFileSync(path.join(folder, 'package.nls.json'), nls);
  return folder;
}

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
    platform: process.platform as Platform,
  };
}

const io: InventoryIo = {
  readFile: readInventoryFile,
  listDirs: async (p) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  },
  readPackageMeta: (folder) => readLocalizedPackageMeta(folder, vscode.env.language, readInventoryFile),
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
  readCandidateFile: readBoundedWorkspaceFile,
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
      ...(typeof extension.packageJSON['version'] === 'string'
        ? { version: extension.packageJSON['version'] }
        : {}),
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
    it('starts with AI features disabled when supported by this VS Code version', guard(async () => {
      const [major, minor] = vscode.version.split('.').map(Number);
      assert.ok(major !== undefined && minor !== undefined, `Unexpected VS Code version: ${vscode.version}`);
      const supportsAIFeatureSetting = major > 1 || (major === 1 && minor >= 104);
      if (supportsAIFeatureSetting) {
        assert.strictEqual(vscode.workspace.getConfiguration('chat').get('disableAIFeatures'), true);
      }
    }));

    it('reads an inventory with the default profile from a fresh sandbox', {skip:!!process.env.PERSONAS_IT_POWERSHELL_ONLY}, guard(async () => {
      inventoryReadCounts.clear();
      writeInstalledFixture(
        'personas-tests.sort-alpha-1.0.0',
        '%displayName%',
        '{ // localized sort fixture\n "displayName": "Alpha Localized",\n}',
      );
      writeInstalledFixture(
        'personas-tests.sort-zulu-1.0.0',
        '%displayName%',
        '{ "displayName": "Zulu Localized" }',
      );
      writeInstalledFixture('personas-tests.folder-fallback-1.0.0', '%displayName%');
      writeInstalledFixture(
        'personas-tests.folder-fallback-2.0.0',
        '%displayName%',
        '{ "displayName": "Later Folder Name" }',
      );
      const literalFolder = writeInstalledFixture(
        'personas-tests.literal-1.0.0',
        'Literal One Read',
        '{ "displayName": "Must not be read" }',
      );
      const inventory = await new InventoryService(testPaths(), io).getInventory();
      assert.ok(inventory.profiles.some((p) => p.isDefault));
      assert.deepStrictEqual(inventory.warnings, []);
      const alphaIndex = inventory.extensions.findIndex((extension) => extension.displayName === 'Alpha Localized');
      const zuluIndex = inventory.extensions.findIndex((extension) => extension.displayName === 'Zulu Localized');
      assert.ok(alphaIndex >= 0 && zuluIndex >= 0 && alphaIndex < zuluIndex, 'localized names did not sort');
      assert.strictEqual(
        inventory.extensions.find((extension) => extension.id === 'personas-tests.folder-fallback')?.displayName,
        'Later Folder Name',
      );
      assert.strictEqual(inventoryReadCounts.get(path.join(literalFolder, 'package.json')), 1);
      assert.strictEqual(inventoryReadCounts.get(path.join(literalFolder, 'package.nls.json')), undefined);
      assert.strictEqual(vscode.workspace.workspaceFolders?.length, 1);
      assert.strictEqual(
        comparableFsPath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''),
        comparableFsPath(workspaceDir),
      );

      const workspaceCandidateFolder = path.join(
        workspaceDir,
        '.vscode',
        'extensions',
        'workspace-candidate',
      );
      const localeFileName = packageNlsLocaleFileNames(vscode.env.language)[0];
      assert.ok(localeFileName, `VS Code reported an unsupported UI language: ${vscode.env.language}`);
      const localeDisplayName = `Localized Workspace Candidate Fixture (${vscode.env.language})`;
      fs.writeFileSync(
        path.join(workspaceCandidateFolder, localeFileName),
        JSON.stringify({ displayName: localeDisplayName }),
      );

      const workspace = await new WorkspaceInventoryService(
        testPaths().storageJson,
        workspaceIo,
        vscode.env.language,
      ).getWorkspaceInventory(inventory);
      assert.ok(workspace, 'workspace inventory missing for disposable folder fixture');
      const candidate = workspace.extensions.find((extension) => extension.id === 'personas-tests.workspace-candidate');
      assert.ok(candidate, 'workspace-local candidate fixture was not discovered');
      assert.strictEqual(candidate.state, 'unknown');
      assert.strictEqual(candidate.workspaceLocal, 'candidate');
      assert.strictEqual(candidate.profileBacked, false);
      assert.strictEqual(candidate.displayName, localeDisplayName);
    }));

    it('CLI changes fire the stable event and the installed fixture becomes positively enabled', {skip:!!process.env.PERSONAS_IT_POWERSHELL_ONLY}, guard(async () => {
      const cliPath = findCli(vscode.env.appRoot, process.platform as Platform, (p) => fs.existsSync(p));
      assert.ok(cliPath, 'CLI not found from appRoot');
      const mutations = new MutationService({
        cliPath,
        extraArgs: ['--user-data-dir', userDataDir, '--extensions-dir', extensionsDir],
        run: createCliRunner({ platform: process.platform as Platform, timeoutMs: SUITE_TIMEOUT_MS }),
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
      assert.strictEqual(installed.displayName, 'Localized Personas Hello Fixture');

      const workspace = await new WorkspaceInventoryService(
        testPaths().storageJson,
        workspaceIo,
        vscode.env.language,
      ).getWorkspaceInventory(inventory);
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

    it('contributes one Home view per area, each of which VS Code can show', guard(async () => {
      // VS Code creates a focus command for every contributed view.
      const before = await vscode.commands.getCommands(true);
      assert.ok(before.includes('personas.vscodeProfiles.focus'));
      assert.ok(before.includes('personas.powerShellProfiles.focus'));
      assert.ok(before.includes('personas.gitConfiguration.focus'));
      assert.ok(!before.includes('personas.home.focus'));
      await vscode.commands.executeCommand('personas.vscodeProfiles.focus');
      await vscode.commands.executeCommand('personas.powerShellProfiles.focus');
      // Showing a view activates the extension in its own time; wait for it here. Activation
      // registers the commands behind the PowerShell Profiles title-bar buttons.
      await vscode.extensions.getExtension('SamErde.personas')!.activate();
      const after = await vscode.commands.getCommands(true);
      assert.ok(after.includes('personas.openSettings'));
      assert.ok(after.includes('personas.powerShellProfiles.refresh'));
      assert.ok(after.includes('personas.powerShellProfiles.help'));
      await vscode.commands.executeCommand('personas.powerShellProfiles.refresh');
    }));

    it('shows the effective Git configuration of the repository the active file is in', guard(async () => {
      const repository = path.join(workspaceDir, 'git-fixture');
      // The caller's Git environment must not reach the fixture: an inherited repository would
      // take the write below, and injected config can stop `git init` before the test begins.
      const env = { ...withoutRepositoryOverrides(process.env), GIT_CONFIG_COUNT: '0' };
      execFileSync('git', ['init', '-q', repository], { env });
      execFileSync('git', ['-C', repository, 'config', '--local', 'user.name', 'Personas Fixture'], { env });
      const file = path.join(repository, 'note.txt');
      fs.writeFileSync(file, 'fixture');
      await vscode.window.showTextDocument(vscode.Uri.file(file));

      await vscode.commands.executeCommand('personas.gitConfiguration.focus');
      await vscode.commands.executeCommand('personas.gitConfiguration.refresh');
      await vscode.commands.executeCommand('personas.gitConfiguration.showEffective');

      const effective = vscode.window.activeTextEditor!.document;
      assert.strictEqual(effective.uri.scheme, 'personas-readonly');
      const text = effective.getText();
      // The fixture repository, its identity value, and the file that value comes from. An error
      // document also starts with "# ", so the header alone would prove nothing.
      assert.match(text, /^# Effective Git configuration\n# Repository: .*git-fixture\n/);
      assert.match(text, /\n {4}Personas Fixture\n {8}local {2}.*git-fixture[\\/]\.git[\\/]config\n/);
    }));

    it('opens a disposable PowerShell profile and blocks deletion of unsaved editor contents', guard(async () => {
      const directory = path.join(workspaceDir, 'powershell-fixture');
      const service = new PowerShellService(async () => [{
        edition: 'PowerShell 7',
        userDirectory: directory,
        installations: [{ id: 'fixture', executable: path.join(directory, 'pwsh'), home: directory }],
      }]);
      const messages: string[] = [];
      let confirmedPath: string | undefined;
      const controller = new PowerShellController(message => messages.push(message.type), service, async file => {
        confirmedPath = file; return true;
      });
      try {
        controller.setActive(true);
        await controller.refresh();
        assert.ok(messages.includes('powerShellState'));
        const row = service.snapshot.rows.find(item => item.scope === 'Current User' && item.host === 'Console')!;
        await controller.handle({type:'powerShellAction',action:'open',id:row.id});
        assert.strictEqual(confirmedPath, row.path);
        const document = vscode.window.activeTextEditor!.document;
        assert.strictEqual(comparableFsPath(document.uri.fsPath), comparableFsPath(row.path!));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0,0), '# unsaved');
        await vscode.workspace.applyEdit(edit);
        assert.ok(document.isDirty);
        await controller.handle({type:'powerShellAction',action:'delete',id:row.id});
        assert.strictEqual(fs.readFileSync(row.path!, 'utf8'), '');
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await deleteProfile(row, {
          confirm: async () => true, isDirty: async () => false, canTrashLinks: false,
          trash: async file => vscode.workspace.fs.delete(vscode.Uri.file(file), {useTrash:true,recursive:false}),
        });
        await waitFor(() => service.row(row.id)?.state === 'missing', 'Watcher did not report deletion');
        createProfileFixture(row.path!, '# external creation');
        await waitFor(() => service.row(row.id)?.state === 'existing', 'Watcher did not report external creation');
        fs.renameSync(directory, directory + '-moved');
        await waitFor(() => service.row(row.id)?.state === 'missing', 'Watcher did not report external directory rename');
        fs.mkdirSync(directory);
        createProfileFixture(row.path!, '# replacement directory');
        await waitFor(() => service.row(row.id)?.state === 'existing', 'Watcher did not report directory recreation');
      } finally { controller.dispose(); }
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

/** Create the fixture atomically; an existing file or link must fail rather than be overwritten. */
function createProfileFixture(file: string, content: string): void {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, content); }
  finally { fs.closeSync(descriptor); }
}

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
