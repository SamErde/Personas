// Removes generated build output and cached VS Code test installs the integration tests no longer
// use. Lists what it would remove by default; pass --force to delete.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const cacheDir = path.join(root, '.vscode-test');
// The folder name format and release API that @vscode/test-electron uses for its cache.
const installName = /^vscode-(?<platform>[a-z0-9-]+)-(?<version>[0-9.]+)$/;
const stableReleasesApi = 'https://update.code.visualstudio.com/api/releases/stable?released=true';

const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
};

function minimumEngineVersion() {
  const engine = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).engines?.vscode ?? '';
  const minimum = /\d+\.\d+\.\d+/.exec(engine)?.[0];
  if (!minimum) throw new Error(`Cannot read a minimum version from engines.vscode ("${engine}").`);
  return minimum;
}

// Matches what a plain `npm run test:integration` downloads, including test-electron's offline fallback.
async function currentStableVersion(cachedVersions) {
  try {
    const response = await fetch(stableReleasesApi, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const [latest] = await response.json();
    if (typeof latest !== 'string') throw new Error('unexpected response');
    return latest;
  } catch (error) {
    const newest = [...cachedVersions].sort(compareVersions).at(-1);
    console.warn(
      `Could not reach the VS Code update service (${error.message}); ` +
        (newest ? `keeping the newest cached version, ${newest}.` : 'no cached version to keep.'),
    );
    return newest;
  }
}

function sizeOf(target) {
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += fs.lstatSync(path.join(entry.parentPath, entry.name)).size;
  }
  return total;
}

const formatSize = (bytes) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const installs = fs.existsSync(cacheDir)
  ? fs.readdirSync(cacheDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, version: installName.exec(entry.name)?.groups?.version }))
      .filter((install) => install.version)
  : [];

const minimum = minimumEngineVersion();
const stable = installs.length ? await currentStableVersion(installs.map((install) => install.version)) : undefined;
const reasons = new Map([[minimum, 'minimum engine version']]);
if (stable) reasons.set(stable, reasons.has(stable) ? 'minimum engine version and current stable' : 'current stable');

const targets = [];
for (const generated of ['dist', 'out-test']) {
  if (fs.existsSync(path.join(root, generated))) targets.push(generated);
}
for (const install of installs) {
  const relative = path.join('.vscode-test', install.name);
  if (reasons.has(install.version)) console.log(`Keeping   ${relative} (${reasons.get(install.version)})`);
  else targets.push(relative);
}

if (!targets.length) {
  console.log('Nothing to clean.');
  process.exit(0);
}

let freed = 0;
for (const relative of targets) {
  const target = path.join(root, relative);
  const size = sizeOf(target);
  if (!force) {
    console.log(`Would remove ${relative} (${formatSize(size)})`);
    freed += size;
    continue;
  }
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    console.log(`Removed   ${relative} (${formatSize(size)})`);
    freed += size;
  } catch (error) {
    console.error(`Could not remove ${relative}: ${error.message}. Close any VS Code test windows and try again.`);
    process.exitCode = 1;
  }
}

console.log(
  force
    ? `Freed ${formatSize(freed)}.`
    : `Would free ${formatSize(freed)}. Run \`npm run clean -- --force\` to remove these.`,
);
