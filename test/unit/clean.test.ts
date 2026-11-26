import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const mib = 1024 * 1024;
const cli = path.resolve('scripts/clean.mjs');
const preload = path.resolve('test/fixtures/cleanup/preload.cjs');
let sandbox: string;
let checkout: string;
let cache: string;

beforeEach(() => {
  sandbox = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'personas-clean-')));
  checkout = path.join(sandbox, 'checkout');
  cache = path.join(checkout, '.vscode-test');
  fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
  fs.copyFileSync(cli, path.join(checkout, 'scripts', 'clean.mjs'));
  fs.copyFileSync(path.resolve('scripts/cleanup-directory.mjs'), path.join(checkout, 'scripts', 'cleanup-directory.mjs'));
  linkDir(path.resolve('node_modules'), path.join(checkout, 'node_modules'));
  fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ engines: { vscode: '^1.101.0' } }));
});
afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 }));

function run(force = false, options: { response?: unknown; status?: number; fault?: string; faultPath?: string; cache?: string } = {}) {
  const args = ['--require', preload, path.join(checkout, 'scripts', 'clean.mjs')];
  if (force) args.push('--force');
  const child = spawnSync(process.execPath, args, {
    cwd: sandbox,
    encoding: 'utf8',
    env: { ...process.env, CLEAN_TEST_OPTIONS: JSON.stringify(options) },
    timeout: 10_000,
  });
  expect(child.error).toBeUndefined();
  return child;
}

function install(platform: string, version: string, complete = true) {
  const name = `vscode-${platform}-${version}`;
  const dir = path.join(cache, name);
  fs.mkdirSync(dir, { recursive: true });
  if (complete) fs.writeFileSync(path.join(dir, 'is-complete'), '');
  return name;
}

function linkDir(destination: string, at: string) {
  fs.symlinkSync(destination, at, 'junction');
}

describe('cleanup CLI', () => {
  it('previews and removes just recognized stale installs and generated output, then becomes a no-op', () => {
    const keep = [
      install('linux-arm64', '1.101.0'), install('darwin', '1.110.0'),
      install('win32-x64-archive', '1.110.0'), install('unknown', '1.1.0'),
      install('linux-x64', '1..2'), install('linux-armhf', 'insiders-backup'),
      install('darwin', 'a'.repeat(39)),
    ];
    const stale = [
      install('linux-x64', '1.99.0'), install('darwin-arm64', 'insiders'),
      install('win32-arm64-archive', '1.110.0-insider'), install('linux-armhf', 'a'.repeat(40)),
    ];
    fs.mkdirSync(path.join(checkout, 'dist'));
    fs.mkdirSync(path.join(checkout, 'out-test'));
    const preview = run();
    expect(preview.status).toBe(0);
    const listed = Array.from(preview.stdout.matchAll(/^Would remove (.*) \([\d.]+ MiB\)$/gm), match => match[1]);
    expect(listed.sort()).toEqual(['dist', 'out-test', ...stale.map(name => path.join('.vscode-test', name))].sort());
    expect(fs.readdirSync(cache).sort()).toEqual([...keep, ...stale].sort());
    expect(fs.readdirSync(checkout)).toEqual(expect.arrayContaining(['dist', 'out-test']));

    const forced = run(true);
    expect(forced.status).toBe(0);
    expect(fs.readdirSync(cache).sort()).toEqual(keep.sort());
    expect(fs.readdirSync(checkout).sort()).toEqual(['.vscode-test', 'node_modules', 'package.json', 'scripts']);
    const repeat = run(true);
    expect(repeat.status).toBe(0);
    expect(repeat.stdout).toContain('Nothing to clean');
  });

  it.each([
    ['timeout', { status: 0 }],
    ['http-error', { status: 503 }],
    ['invalid-string', { response: '1.110.0' }],
    ['invalid-first', { response: ['invalid'] }],
  ] as const)('keeps complete fallbacks by platform on %s', (_scenario, options) => {
    const keep = [
      install('linux-x64', '1.100.0'), install('linux-x64', '1.101.0', false),
      install('darwin', '1.109.0'), install('linux-armhf', '1.20.0', false), install('linux-armhf', 'insiders'),
    ];
    install('linux-x64', '1.99.0');
    install('linux-x64', '1.111.0', false);
    install('linux-x64', 'insiders');
    install('darwin', '1.108.0');
    const result = run(true, options);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${keep[0]} (offline fallback)`);
    expect(result.stdout).toContain(`${keep[1]} (minimum engine version)`);
    expect(result.stdout).toContain(`${keep[2]} (offline fallback)`);
    expect(result.stdout).toContain('Keeping linux-armhf installs');
    expect(fs.readdirSync(cache).sort()).toEqual(keep.sort());
  });

  it('protects a coincident minimum and stable, leaving linked cache entries alone', () => {
    const minimum = install('darwin', '1.101.0');
    const shared = path.join(sandbox, 'shared');
    fs.mkdirSync(shared);
    const link = path.join(cache, 'vscode-darwin-1.99.0');
    linkDir(shared, link);
    expect(run(true, { response: ['1.101.0'] }).status).toBe(0);
    expect(fs.readdirSync(cache).sort()).toEqual([minimum, path.basename(link)].sort());
  });

  it('rejects linked roots and non-directory roots but continues with ordinary targets', () => {
    const external = path.join(sandbox, 'shared-cache');
    const sentinel = path.join(external, 'vscode-linux-x64-1.99.0', 'keep');
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, 'untouched');
    linkDir(external, cache);
    const dist = path.join(checkout, 'dist');
    linkDir(external, dist);
    fs.mkdirSync(path.join(checkout, 'out-test'));
    for (const force of [false, true]) {
      const result = run(force);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Skipping .vscode-test');
      expect(result.stderr).toContain('Skipping dist');
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('untouched');
      expect(fs.existsSync(path.join(checkout, 'out-test'))).toBe(!force);
    }

    fs.unlinkSync(cache);
    fs.writeFileSync(cache, 'ordinary file');
    const brokenTarget = path.join(sandbox, 'missing');
    fs.mkdirSync(brokenTarget);
    fs.unlinkSync(dist);
    linkDir(brokenTarget, dist);
    fs.rmdirSync(brokenTarget);
    const result = run(true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Skipping dist');
    expect(result.stderr).toContain('Skipping .vscode-test');
    expect(result.stdout).not.toContain('Nothing to clean');
    expect(fs.lstatSync(dist).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(cache, 'utf8')).toBe('ordinary file');
  });

  it('does not count or remove the contents of a nested directory link', () => {
    const external = path.join(sandbox, 'shared');
    const dist = path.join(checkout, 'dist');
    fs.mkdirSync(dist);
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, 'sentinel'), Buffer.alloc(2 * mib));
    fs.writeFileSync(path.join(dist, 'generated'), Buffer.alloc(mib));
    linkDir(external, path.join(dist, 'linked'));
    for (const force of [false, true]) {
      const result = run(force);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('dist (1.0 MiB)');
      expect(fs.statSync(path.join(external, 'sentinel')).size).toBe(2 * mib);
    }
    expect(fs.existsSync(dist)).toBe(false);
  });

  it.each([
    { force: false, fault: 'rotate-at-list', leaf: '.', sizeMessage: 'Would remove' },
    { force: true, fault: 'rotate-at-unlink', leaf: 'file', sizeMessage: 'Removed' },
  ])('keeps the selected cache bound during $fault', ({ force, fault, leaf, sizeMessage }) => {
    const name = install('linux-x64', '1.99.0', false);
    const target = path.join(cache, name);
    fs.writeFileSync(path.join(target, 'file'), Buffer.alloc(mib));
    const replacement = path.join(checkout, 'replacement', name);
    fs.mkdirSync(replacement, { recursive: true });
    fs.writeFileSync(path.join(replacement, 'file'), Buffer.alloc(2 * mib));

    const faultPath = path.join(target, leaf);
    const result = run(force, { fault, faultPath, cache });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`${sizeMessage} ${path.join('.vscode-test', name)} (1.0 MiB)`);
    const [outcome, survivor, original] = process.platform === 'win32'
      ? ['rotation blocked', replacement, target] as const
      : ['rotation completed', target, path.join(checkout, 'original', name)] as const;
    expect(result.stderr).toContain(outcome);
    expect(fs.statSync(path.join(survivor, 'file')).size).toBe(2 * mib);
    expect(fs.existsSync(original)).toBe(!force);
  });

  it.each(['marker-error', 'linked-marker'])('preserves the affected platform on %s', (fault) => {
    const uncertain = install('linux-x64', '1.115.0', false);
    const marker = path.join(cache, uncertain, 'is-complete');
    if (fault === 'linked-marker') {
      const external = path.join(sandbox, 'marker-destination');
      fs.mkdirSync(external);
      linkDir(external, marker);
    }
    const kept = [uncertain, install('linux-x64', '1.105.0'), install('linux-x64', 'insiders'), install('darwin', '1.120.0')];
    install('darwin', '1.110.0');
    const result = run(true, { response: [], fault, faultPath: marker });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('keeping linux-x64 installs');
    expect(fs.readdirSync(cache).sort()).toEqual(kept.sort());
  });

  it.each([
    ['scan-error', 'dist', 'simulated scan-error'],
    ['remove-error', 'dist', 'simulated remove-error'],
    ['changed-directory', 'dist/nested', 'directory changed during cleanup'],
  ])('reports %s, continues, and completes on retry', (fault, relativePath, expectedError) => {
    const dist = path.join(checkout, 'dist');
    const out = path.join(checkout, 'out-test');
    for (const dir of [dist, out]) {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'file'), Buffer.alloc(mib));
    }
    fs.mkdirSync(path.join(dist, 'nested'));
    const result = run(true, { fault, faultPath: path.join(checkout, relativePath) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Skipping dist');
    expect(result.stderr).toContain(expectedError);
    expect(result.stderr).toContain('Cleanup incomplete');
    expect(result.stdout).toContain('Removed 1 target(s), estimated 1.0 MiB');
    expect(fs.existsSync(dist)).toBe(true);
    expect(fs.existsSync(out)).toBe(false);
    expect(run(true).status).toBe(0);
    expect(fs.existsSync(dist)).toBe(false);
  });
});
