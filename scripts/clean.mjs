// Preview cleanup by default. Only --force removes files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootPath = fs.realpathSync.native(fileURLToPath(new URL('../', import.meta.url)));
const force = process.argv.includes('--force');
const stableReleasesApi = 'https://update.code.visualstudio.com/api/releases/stable?released=true';
// Desktop platforms and version IDs emitted by @vscode/test-electron 3.1.0.
const platformPattern = 'darwin-arm64|darwin|win32-(?:x64|arm64)-archive|linux-(?:x64|arm64|armhf)';
const component = '(?:0|[1-9][0-9]*)';
const releasePattern = `${component}\\.${component}\\.${component}`;
const release = new RegExp(`^${releasePattern}$`);
const installName = new RegExp(`^vscode-(${platformPattern})-(${releasePattern}(?:-insider)?|insiders|[0-9a-f]{40})$`);
const versionOrder = new Intl.Collator('en', { numeric: true });

let failures = 0;
let removedOrListed = 0;
let bytes = 0;

function reportFailure(location, error) {
  failures++;
  process.exitCode = 1;
  console.error(`Skipping ${path.relative(rootPath, location) || '.'}: ${error.message}`);
}

// Only callers with literal child names or names from a direct readdir can create targets.
function directory(location, parent, optional = false) {
  const stat = fs.lstatSync(location, { bigint: true, throwIfNoEntry: !optional });
  if (!stat) return undefined;
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      path.relative(location, fs.realpathSync.native(location)) !== '' ||
      (parent && path.relative(parent.location, path.dirname(location)) !== '')) {
    throw new Error('expected an ordinary directory at its original checkout path');
  }
  return { location, parent, stat };
}

function checkIdentity(dir) {
  const current = directory(dir.location, dir.parent);
  if (current.stat.dev !== dir.stat.dev || current.stat.ino !== dir.stat.ino) {
    throw new Error(`directory changed during cleanup: ${dir.location}`);
  }
}

function recheck(dir) {
  if (dir.parent) recheck(dir.parent);
  checkIdentity(dir);
}

function sizeOf(target) {
  let total = 0;
  const pending = [target];
  while (pending.length) {
    const current = pending.pop();
    // A queued Dirent may be stale. Reopen only an ordinary directory with the same identity.
    checkIdentity(current);
    for (const entry of fs.readdirSync(current.location, { withFileTypes: true })) {
      const child = path.join(current.location, entry.name);
      if (entry.isDirectory()) pending.push(directory(child, current));
      else if (entry.isFile()) total += fs.lstatSync(child).size;
    }
  }
  return total;
}

function formatSize(size) {
  return `${(size / 1024 ** 2).toFixed(1)} MiB`;
}

function processTarget(parent, name, optional = false) {
  const location = path.join(parent.location, name);
  try {
    recheck(parent);
    const target = directory(location, parent, optional);
    if (!target) return;
    const size = sizeOf(target);
    if (force) {
      recheck(target);
      fs.rmSync(location, { recursive: true, maxRetries: 3 });
    }
    console.log(`${force ? 'Removed' : 'Would remove'} ${path.relative(rootPath, location)} (${formatSize(size)})`);
    removedOrListed++;
    bytes += size;
  } catch (error) {
    reportFailure(location, error);
  }
}

async function currentStable() {
  try {
    const response = await fetch(stableReleasesApi, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const releases = await response.json();
    if (!Array.isArray(releases) || typeof releases[0] !== 'string' || !release.test(releases[0])) {
      throw new Error('unexpected stable release list');
    }
    return releases[0];
  } catch (error) {
    console.warn(`Stable release unavailable (${error.message}). Checking offline fallbacks per platform.`);
    return undefined;
  }
}

function newestComplete(cache, installs) {
  let newest;
  for (const { name, version } of installs) {
    if (!release.test(version)) continue;
    recheck(cache);
    const install = directory(path.join(cache.location, name), cache);
    const markerPath = path.join(install.location, 'is-complete');
    const marker = fs.lstatSync(markerPath, { throwIfNoEntry: false });
    if (!marker) continue;
    if (!marker.isFile()) throw new Error(`expected a regular completion marker at ${markerPath}`);
    if (!newest || versionOrder.compare(version, newest) > 0) newest = version;
  }
  return newest;
}

function installsByPlatform(cache) {
  const groups = new Map();
  for (const entry of fs.readdirSync(cache.location, { withFileTypes: true })) {
    const match = installName.exec(entry.name);
    if (!match || !entry.isDirectory()) continue;
    const [, platform, version] = match;
    if (!groups.has(platform)) groups.set(platform, []);
    groups.get(platform).push({ name: entry.name, version });
  }
  return groups;
}

function processPlatform(cache, platform, installs, minimum, stable) {
  const retained = stable ?? newestComplete(cache, installs);
  if (!retained) {
    console.log(`Keeping ${platform} installs (no complete offline release found).`);
    return;
  }
  const reasons = new Map([
    [retained, stable ? 'current stable' : 'offline fallback'],
    [minimum, 'minimum engine version'],
  ]);
  for (const { name, version } of installs) {
    if (reasons.has(version)) console.log(`Keeping ${path.join('.vscode-test', name)} (${reasons.get(version)})`);
    else processTarget(cache, name);
  }
}

async function processCache(cache) {
  const groups = installsByPlatform(cache);
  if (!groups.size) return;

  const manifest = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8'));
  const minimum = manifest.engines?.vscode?.match(new RegExp(`^\\^?(${releasePattern})$`))?.[1];
  if (!minimum) throw new Error('expected an exact or caret-prefixed engines.vscode minimum');

  const stable = await currentStable();
  for (const [platform, installs] of groups) {
    try {
      processPlatform(cache, platform, installs, minimum, stable);
    } catch (error) {
      reportFailure(cache.location, new Error(`keeping ${platform} installs: ${error.message}`));
    }
  }
}

const root = directory(rootPath);
for (const name of ['dist', 'out-test']) processTarget(root, name, true);

const cachePath = path.join(rootPath, '.vscode-test');
try {
  recheck(root);
  const cache = directory(cachePath, root, true);
  if (cache) await processCache(cache);
} catch (error) {
  reportFailure(cachePath, error);
}

if (!removedOrListed && !failures) console.log('Nothing to clean.');
else {
  console.log(`${force ? 'Removed' : 'Would remove'} ${removedOrListed} target(s), estimated ${formatSize(bytes)}.`);
  if (failures) console.error(`Cleanup incomplete: ${failures} error(s).`);
  if (!force && removedOrListed) console.log('Run `npm run clean -- --force` to remove the listed targets.');
}
