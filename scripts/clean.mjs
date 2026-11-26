// Preview cleanup by default. Only --force removes files.
import fs from 'node:fs';
import path from 'node:path';
import { assertIdentity, openDirectory } from './cleanup-directory.mjs';
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
  console.error(`Skipping ${location}: ${error.message}`);
}

// Every lookup is a single child of a held parent. Only non-recursive unlink/rmdir
// operate on names; a replacement can never become the root of a recursive removal.
function removeEmpty(parent, name, expected) {
  assertIdentity(expected, fs.lstatSync(parent.at(name), { bigint: true }));
  fs.rmdirSync(parent.at(name));
}

function walk(dir, remove) {
  let total = 0;
  for (const name of fs.readdirSync(dir.at('.'))) {
    const entry = fs.lstatSync(dir.at(name), { bigint: true });
    if (entry.isDirectory()) {
      {
        using child = openDirectory(dir.at(name), entry);
        total += walk(child, remove);
      }
      if (remove) removeEmpty(dir, name, entry);
    } else {
      if (entry.isFile()) total += Number(entry.size);
      if (remove) fs.unlinkSync(dir.at(name));
    }
  }
  return total;
}

function formatSize(size) {
  return `${(size / 1024 ** 2).toFixed(1)} MiB`;
}

function processTarget(parent, name, relative = name) {
  try {
    const entry = fs.lstatSync(parent.at(name), { bigint: true, throwIfNoEntry: parent !== root });
    if (!entry) return;
    let size;
    {
      using target = openDirectory(parent.at(name), entry);
      size = walk(target, false);
      if (force) walk(target, true);
    }
    if (force) removeEmpty(parent, name, entry);
    console.log(`${force ? 'Removed' : 'Would remove'} ${relative} (${formatSize(size)})`);
    removedOrListed++;
    bytes += size;
  } catch (error) {
    reportFailure(relative, error);
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
    const entry = fs.lstatSync(cache.at(name), { bigint: true });
    using install = openDirectory(cache.at(name), entry);
    const marker = fs.lstatSync(install.at('is-complete'), { throwIfNoEntry: false });
    if (!marker) continue;
    if (!marker.isFile()) throw new Error(`expected a regular completion marker in ${name}`);
    if (!newest || versionOrder.compare(version, newest) > 0) newest = version;
  }
  return newest;
}

function installsByPlatform(cache) {
  const groups = new Map();
  for (const entry of fs.readdirSync(cache.at('.'), { withFileTypes: true })) {
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
    else processTarget(cache, name, path.join('.vscode-test', name));
  }
}

async function processCache(cache) {
  const groups = installsByPlatform(cache);
  if (!groups.size) return;

  const manifest = JSON.parse(fs.readFileSync(root.at('package.json'), 'utf8'));
  const minimum = manifest.engines?.vscode?.match(new RegExp(`^\\^?(${releasePattern})$`))?.[1];
  if (!minimum) throw new Error('expected an exact or caret-prefixed engines.vscode minimum');

  const stable = await currentStable();
  for (const [platform, installs] of groups) {
    try {
      processPlatform(cache, platform, installs, minimum, stable);
    } catch (error) {
      reportFailure('.vscode-test', new Error(`keeping ${platform} installs: ${error.message}`));
    }
  }
}

using root = openDirectory(rootPath, fs.lstatSync(rootPath, { bigint: true }));
for (const name of ['dist', 'out-test']) processTarget(root, name);

try {
  const entry = fs.lstatSync(root.at('.vscode-test'), { bigint: true, throwIfNoEntry: false });
  if (entry) {
    using cache = openDirectory(root.at('.vscode-test'), entry);
    await processCache(cache);
  }
} catch (error) {
  reportFailure('.vscode-test', error);
}

if (!removedOrListed && !failures) console.log('Nothing to clean.');
else {
  console.log(`${force ? 'Removed' : 'Would remove'} ${removedOrListed} target(s), estimated ${formatSize(bytes)}.`);
  if (failures) console.error(`Cleanup incomplete: ${failures} error(s).`);
  if (!force && removedOrListed) console.log('Run `npm run clean -- --force` to remove the listed targets.');
}
