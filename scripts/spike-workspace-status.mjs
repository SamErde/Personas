// Supported-API probe for current-workspace extension status.
// Uses only disposable VS Code user-data/extension directories and public extension APIs.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  const associationRuns = [];
  for (const associationCase of [
    {
      label: 'default-saved-workspace',
      target: path.join(root, 'test', 'spike', 'workspace-status.code-workspace'),
    },
    {
      label: 'named-folder',
      target: path.join(root, 'test', 'spike', 'workspace-root'),
      profile: 'Spike Named',
    },
    {
      label: 'named-saved-workspace',
      target: path.join(root, 'test', 'spike', 'workspace-status.code-workspace'),
      profile: 'Spike Named',
    },
  ]) {
    const associationResultPath = path.join(sandbox, `${associationCase.label}.json`);
    const launchArgs = [
      associationCase.target,
      '--user-data-dir', userDataDir,
      '--extensions-dir', extensionsDir,
      '--disable-workspace-trust',
      '--skip-welcome',
    ];
    if (associationCase.profile) launchArgs.push('--profile', associationCase.profile);
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: path.join(root, 'test', 'spike', 'workspace-status-extension'),
      extensionTestsPath: path.join(root, 'test', 'spike', 'workspace-association-suite', 'index.js'),
      launchArgs,
      extensionTestsEnv: { PERSONAS_SPIKE_RESULT: associationResultPath },
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
