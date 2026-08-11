'use strict';

const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const vscode = require('vscode');

const fixtureId = 'personas-tests.personas-hello-fixture';
const webFixtureId = 'personas-tests.personas-web-fixture';
const localId = 'personas-tests.personas-local-workspace-fixture';

function snapshot(label) {
  return {
    label,
    workspaceFile: vscode.workspace.workspaceFile?.toString(),
    workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()) ?? [],
    extensions: vscode.extensions.all.map((extension) => ({
      id: extension.id.toLowerCase(),
      uri: extension.extensionUri.toString(),
      kind: extension.packageJSON.extensionKind,
    })),
  };
}

function runCli(args) {
  const cli = process.env.PERSONAS_SPIKE_CLI;
  const prefix = JSON.parse(process.env.PERSONAS_SPIKE_CLI_PREFIX ?? '[]');
  assert.ok(cli, 'missing PERSONAS_SPIKE_CLI');
  const result = childProcess.spawnSync(cli, [...prefix, ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  if (result.status !== 0) {
    throw new Error(`CLI failed (${String(result.status)}): ${result.stdout}\n${result.stderr}`);
  }
}

function waitFor(predicate, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error('timed out waiting for extension snapshot'));
      setTimeout(check, 100);
    };
    check();
  });
}

exports.run = async function run() {
  const resultPath = process.env.PERSONAS_SPIKE_RESULT;
  const userDataDir = process.env.PERSONAS_SPIKE_USER_DATA;
  const extensionsDir = process.env.PERSONAS_SPIKE_EXTENSIONS;
  const vsixPath = process.env.PERSONAS_SPIKE_VSIX;
  assert.ok(resultPath && userDataDir && extensionsDir && vsixPath, 'missing spike paths');

  const snapshots = [snapshot('initial')];
  assert.ok(vscode.extensions.getExtension(fixtureId), 'installed fixture was not visible');
  assert.ok(vscode.extensions.getExtension(webFixtureId), 'installed browser-only fixture was not visible');
  assert.strictEqual(vscode.extensions.getExtension(localId), undefined, 'candidate-only local extension looked installed');

  let changeEvents = 0;
  const listener = vscode.extensions.onDidChange(() => {
    changeEvents += 1;
    snapshots.push(snapshot(`onDidChange-${changeEvents}`));
  });

  runCli([
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--uninstall-extension', fixtureId,
  ]);
  await waitFor(() => vscode.extensions.getExtension(fixtureId) === undefined);
  snapshots.push(snapshot('after-uninstall'));

  runCli([
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--install-extension', vsixPath,
  ]);
  await waitFor(() => vscode.extensions.getExtension(fixtureId) !== undefined);
  snapshots.push(snapshot('after-reinstall'));
  listener.dispose();

  fs.writeFileSync(resultPath, JSON.stringify({ changeEvents, snapshots }, null, 2));
};
