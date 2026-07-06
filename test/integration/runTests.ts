import { runTests } from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'personas-it-data-'));
  const extensionsDir = mkdtempSync(path.join(tmpdir(), 'personas-it-ext-'));

  // Package the fixture here, in the plain launcher process: invoking vsce (which needs a
  // shell on Windows) from inside the sandboxed Extension Development Host fails with
  // "spawnSync .../cmd.exe ENOENT" (verified locally) — that process restricts child-process
  // creation. Packaging is a build-time concern anyway, not something the suite should redo.
  const fixtureDir = path.resolve(extensionDevelopmentPath, 'test', 'fixtures', 'hello-ext');
  const vsce = path.resolve(
    extensionDevelopmentPath,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vsce.cmd' : 'vsce',
  );
  const vsixPath = path.join(fixtureDir, 'fixture.vsix');
  execFileSync(vsce, ['package', '--allow-missing-repository', '--out', vsixPath], {
    cwd: fixtureDir,
    shell: process.platform === 'win32',
  });

  // This machine sets ELECTRON_RUN_AS_NODE=1 globally, which makes runTests() spawn Code.exe as a bare Node process instead of the real GUI (docs/spikes/findings.md, Spike B).
  delete process.env.ELECTRON_RUN_AS_NODE;

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      '--user-data-dir', userDataDir,
      '--extensions-dir', extensionsDir,
      '--disable-workspace-trust',
      '--skip-welcome',
    ],
    extensionTestsEnv: {
      PERSONAS_IT_USER_DATA: userDataDir,
      PERSONAS_IT_EXT_DIR: extensionsDir,
      PERSONAS_IT_VSIX_PATH: vsixPath,
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
