// Supported-API probe for current-workspace extension status.
// Uses only disposable VS Code user-data/extension directories and public extension APIs.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

const root = path.resolve(import.meta.dirname, '..');
const versions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['1.90.2', 'stable'];
const fixtureDir = path.join(root, 'test', 'fixtures', 'hello-ext');
const vsixPath = path.join(fixtureDir, 'fixture.vsix');
const webFixtureDir = path.join(root, 'test', 'fixtures', 'web-ext');
const webVsixPath = path.join(webFixtureDir, 'fixture.vsix');
const associationProbeDir = path.join(root, 'test', 'spike', 'workspace-status-extension');
const associationProbeVsixPath = path.join(associationProbeDir, 'association-probe.vsix');
const vsce = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');

execFileSync(vsce, ['package', '--allow-missing-repository', '--out', vsixPath], {
  cwd: fixtureDir,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});
execFileSync(vsce, ['package', '--allow-missing-repository', '--out', webVsixPath], {
  cwd: webFixtureDir,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});
execFileSync(vsce, ['package', '--allow-missing-repository', '--out', associationProbeVsixPath], {
  cwd: associationProbeDir,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

async function waitForProbeResult(resultPath, child, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(resultPath)) {
    if (child.exitCode !== null) throw new Error(`regular VS Code probe exited with ${child.exitCode}`);
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${resultPath}`);
    await delay(100);
  }
}

async function stopDisposableWindow(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = once(child, 'exit');
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } catch {
      if (child.exitCode === null) child.kill();
    }
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit'), delay(5000)]);
  }
}

async function runRegularWindowAssociationProbe({ executable, target, profile, userDataDir, extensionsDir, resultPath }) {
  const args = [
    target,
    '--new-window',
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--disable-workspace-trust',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--no-sandbox',
  ];
  if (profile) args.push('--profile', profile);
  const env = { ...process.env, PERSONAS_ASSOCIATION_PROBE_RESULT: resultPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, args, { env, stdio: 'ignore' });
  try {
    await waitForProbeResult(resultPath, child);
    // The installed probe writes after startup; leave a short flush window for storage.json.
    await delay(1000);
  } finally {
    await stopDisposableWindow(child);
  }
}

async function ensureNamedProfile({ executable, target, profile, userDataDir, extensionsDir, storagePath }) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [
    target,
    '--new-window',
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--profile', profile,
    '--disable-workspace-trust',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--no-sandbox',
  ], { env, stdio: 'ignore' });
  const deadline = Date.now() + 45000;
  try {
    for (;;) {
      if (child.exitCode !== null) throw new Error(`profile-creation window exited with ${child.exitCode}`);
      if (existsSync(storagePath)) {
        try {
          const storage = JSON.parse(readFileSync(storagePath, 'utf8'));
          if (storage.userDataProfiles?.some((item) => item.name === profile)) break;
        } catch {
          // storage.json may be between atomic updates; retry until the deadline.
        }
      }
      if (Date.now() >= deadline) throw new Error(`timed out creating disposable profile ${profile}`);
      await delay(100);
    }
    await delay(500);
  } finally {
    await stopDisposableWindow(child);
  }
}

delete process.env.ELECTRON_RUN_AS_NODE;

for (const version of versions) {
  const sandbox = mkdtempSync(path.join(tmpdir(), `personas-workspace-spike-${version.replaceAll('.', '-')}-`));
  const userDataDir = path.join(sandbox, 'user-data');
  const extensionsDir = path.join(sandbox, 'extensions');
  const resultPath = path.join(sandbox, 'result.json');
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(extensionsDir, { recursive: true });

  const executable = await downloadAndUnzipVSCode(version);
  const [cli, ...cliPrefix] = resolveCliArgsFromVSCodeExecutablePath(executable);
  execFileSync(cli, [
    ...cliPrefix,
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--install-extension', vsixPath,
  ], { shell: process.platform === 'win32', stdio: 'inherit' });
  execFileSync(cli, [
    ...cliPrefix,
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--install-extension', webVsixPath,
  ], { shell: process.platform === 'win32', stdio: 'inherit' });

  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: path.join(root, 'test', 'spike', 'workspace-status-extension'),
    extensionTestsPath: path.join(root, 'test', 'spike', 'workspace-status-suite', 'index.js'),
    launchArgs: [
      path.join(root, 'test', 'spike', 'workspace-root'),
      '--user-data-dir', userDataDir,
      '--extensions-dir', extensionsDir,
      '--disable-workspace-trust',
      '--skip-welcome',
    ],
    extensionTestsEnv: {
      PERSONAS_SPIKE_CLI: cli,
      PERSONAS_SPIKE_CLI_PREFIX: JSON.stringify(cliPrefix),
      PERSONAS_SPIKE_RESULT: resultPath,
      PERSONAS_SPIKE_USER_DATA: userDataDir,
      PERSONAS_SPIKE_EXTENSIONS: extensionsDir,
      PERSONAS_SPIKE_VSIX: vsixPath,
    },
  });

  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  const storagePath = path.join(userDataDir, 'User', 'globalStorage', 'storage.json');
  execFileSync(cli, [
    ...cliPrefix,
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--install-extension', associationProbeVsixPath,
  ], { shell: process.platform === 'win32', stdio: 'inherit' });
  await ensureNamedProfile({
    executable,
    target: path.join(root, 'test', 'spike', 'workspace-root'),
    profile: 'SpikeNamed',
    userDataDir,
    extensionsDir,
    storagePath,
  });
  execFileSync(cli, [
    ...cliPrefix,
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--profile', 'SpikeNamed',
    '--install-extension', associationProbeVsixPath,
  ], { shell: process.platform === 'win32', stdio: 'inherit' });
  const associationRuns = [];
  for (const associationCase of [
    {
      label: 'default-saved-workspace',
      target: path.join(root, 'test', 'spike', 'workspace-status.code-workspace'),
    },
    {
      label: 'named-folder',
      target: path.join(root, 'test', 'spike', 'workspace-root'),
      profile: 'SpikeNamed',
    },
    {
      label: 'named-saved-workspace',
      target: path.join(root, 'test', 'spike', 'workspace-status.code-workspace'),
      profile: 'SpikeNamed',
    },
  ]) {
    const associationResultPath = path.join(sandbox, `${associationCase.label}.json`);
    await runRegularWindowAssociationProbe({
      executable,
      target: associationCase.target,
      profile: associationCase.profile,
      userDataDir,
      extensionsDir,
      resultPath: associationResultPath,
    });
    const storage = JSON.parse(readFileSync(storagePath, 'utf8'));
    associationRuns.push({
      label: associationCase.label,
      api: JSON.parse(readFileSync(associationResultPath, 'utf8')),
      profileAssociations: storage.profileAssociations,
      userDataProfiles: storage.userDataProfiles,
    });
  }

  const fixtureSnapshots = result.snapshots.map((item) => ({
    label: item.label,
    workspaceFile: item.workspaceFile,
    workspaceFolders: item.workspaceFolders,
    fixtures: item.extensions.filter((extension) => extension.id.startsWith('personas-tests.')),
  }));
  console.log(JSON.stringify({
    requestedVersion: version,
    executable,
    sandbox,
    changeEvents: result.changeEvents,
    fixtureSnapshots,
    associationRuns,
  }, null, 2));
}
