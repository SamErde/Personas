import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCliRunner } from '../../src/core/cliRunner';
import type { Platform } from '../../src/core/paths';
import { GitConfigService, type GitConfigInclude, type GitConfigSnapshot } from '../../src/git/configService';

/**
 * Runs real Git against a throwaway repository whose system and global config are isolated, so
 * these tests can disagree with the code about how Git behaves.
 */
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

const slash = (file: string) => file.split('\\').join('/');

async function sandbox(globalConfig: (dirs: { home: string; repo: string }) => string) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-git-'));
  roots.push(temporary);
  const root = await fs.realpath(temporary);
  const home = path.join(root, 'home');
  const repo = path.join(root, 'repo');
  await fs.mkdir(home);
  await fs.mkdir(path.join(repo, 'src'), { recursive: true });
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), HOME: home };
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
  await fs.writeFile(path.join(home, '.gitconfig'), globalConfig({ home, repo }));
  const service = new GitConfigService({
    run: createCliRunner({ platform: process.platform as Platform, timeoutMs: 20_000 }),
    gitPath: () => 'git',
    env,
  });
  return { root, home, repo, service, env };
}

async function inspect(service: GitConfigService, ...folders: string[]): Promise<GitConfigSnapshot> {
  const result = await service.inspect(folders);
  if (result.kind !== 'ok') throw new Error(`expected a snapshot, got ${JSON.stringify(result)}`);
  return result;
}

const base = '[user]\n\tname = Base\n\temail = base@example.com\n';

it('reports the effective identity with the file each value comes from', async () => {
  const { home, repo, service } = await sandbox(
    ({ repo }) => `${base}[includeIf "gitdir:${slash(repo)}/"]\n\tpath = work.inc\n`,
  );
  await fs.writeFile(path.join(home, 'work.inc'), '[user]\n\temail = work@example.com\n');

  const snapshot = await inspect(service, path.join(repo, 'src'));

  expect(snapshot.repository).toMatchObject({ name: 'repo', root: repo, gitDir: path.join(repo, '.git') });
  expect(snapshot.identity).toEqual([
    { key: 'user.name', value: 'Base', scope: 'global', file: path.join(home, '.gitconfig') },
    { key: 'user.email', value: 'work@example.com', scope: 'global', file: path.join(home, 'work.inc') },
  ]);
});

it('lists the config files by scope and nests each include under its parent with its status', async () => {
  const { home, repo, service } = await sandbox(({ repo }) =>
    [
      base,
      '[include]\n\tpath = empty.inc\n',
      `[includeIf "gitdir:${slash(repo)}/"]\n\tpath = work.inc\n`,
      '[includeIf "gitdir:/nowhere/"]\n\tpath = elsewhere.inc\n',
      '[includeIf "onbranch:main"]\n\tpath = ~/missing.inc\n',
    ].join(''),
  );
  await fs.writeFile(path.join(home, 'empty.inc'), '');
  await fs.writeFile(path.join(home, 'work.inc'), '[user]\n\temail = work@example.com\n[include]\n\tpath = nested/deep.inc\n');
  await fs.mkdir(path.join(home, 'nested'));
  await fs.writeFile(path.join(home, 'nested', 'deep.inc'), '[core]\n\teditor = code\n');
  await fs.writeFile(path.join(home, 'elsewhere.inc'), '[user]\n\tname = Elsewhere\n');

  const snapshot = await inspect(service, repo);

  expect(snapshot.files.map((file) => [file.scope, file.path])).toEqual([
    ['global', path.join(home, '.gitconfig')],
    ['local', path.join(repo, '.git', 'config')],
  ]);
  const summary = (include: GitConfigInclude): unknown => ({
    written: include.writtenPath,
    path: include.path,
    condition: include.condition,
    status: include.status,
    includes: include.includes.map(summary),
  });
  expect(snapshot.files[0]!.includes.map(summary)).toEqual([
    { written: 'empty.inc', path: path.join(home, 'empty.inc'), condition: undefined, status: 'empty', includes: [] },
    {
      written: 'work.inc',
      path: path.join(home, 'work.inc'),
      condition: `gitdir:${slash(repo)}/`,
      status: 'applied',
      includes: [
        {
          written: 'nested/deep.inc',
          path: path.join(home, 'nested', 'deep.inc'),
          condition: undefined,
          status: 'applied',
          includes: [],
        },
      ],
    },
    {
      written: 'elsewhere.inc',
      path: path.join(home, 'elsewhere.inc'),
      condition: 'gitdir:/nowhere/',
      status: 'notApplied',
      includes: [],
    },
    {
      written: '~/missing.inc',
      path: path.join(home, 'missing.inc'),
      condition: 'onbranch:main',
      status: 'missing',
      includes: [],
    },
  ]);
});

it('keeps every value in the order Git reads it, with scope and source file', async () => {
  const { home, repo, service } = await sandbox(() => base);
  await fs.appendFile(path.join(repo, '.git', 'config'), '[user]\n\tname = Local\n[alias]\n\tnote = "!f() {\\n echo hi\\n}; f"\n');

  const snapshot = await inspect(service, repo);

  const names = snapshot.entries.filter((entry) => entry.key === 'user.name');
  expect(names).toEqual([
    { key: 'user.name', value: 'Base', scope: 'global', origin: expect.any(String), file: path.join(home, '.gitconfig') },
    { key: 'user.name', value: 'Local', scope: 'local', origin: expect.any(String), file: path.join(repo, '.git', 'config') },
  ]);
  expect(snapshot.identity[0]).toMatchObject({ value: 'Local', scope: 'local' });
  // A value that spans lines stays one value.
  expect(snapshot.entries.find((entry) => entry.key === 'alias.note')?.value).toBe('!f() {\n echo hi\n}; f');
});

it('outside a repository, shows system and global config only and makes no claim about includeIf rules', async () => {
  const { root, home, service } = await sandbox(() =>
    `${base}[include]\n\tpath = always.inc\n[includeIf "gitdir:/nowhere/"]\n\tpath = elsewhere.inc\n`,
  );
  await fs.writeFile(path.join(home, 'always.inc'), '[core]\n\teditor = code\n');
  await fs.writeFile(path.join(home, 'elsewhere.inc'), '[user]\n\tname = Elsewhere\n');

  for (const folders of [[root], []]) {
    const snapshot = await inspect(service, ...folders);
    expect(snapshot.repository).toBeUndefined();
    expect(snapshot.files.map((file) => file.scope)).toEqual(['global']);
    expect(snapshot.entries.every((entry) => entry.scope === 'global')).toBe(true);
    expect(snapshot.files[0]!.includes.map((include) => [include.writtenPath, include.status])).toEqual([
      ['always.inc', 'applied'],
      ['elsewhere.inc', undefined],
    ]);
  }
});

it('with no current repository, ignores a repository the home folder happens to be', async () => {
  const { home, service, env } = await sandbox(() => `${base}[includeIf "onbranch:main"]\n\tpath = branch.inc\n`);
  await fs.writeFile(path.join(home, 'branch.inc'), '[user]\n\tname = Branch\n');
  execFileSync('git', ['init', '-q', '-b', 'main', home], { env });

  const snapshot = await inspect(service);

  expect(snapshot.identity[0]).toMatchObject({ value: 'Base', file: path.join(home, '.gitconfig') });
  expect(snapshot.entries.every((entry) => entry.scope === 'global')).toBe(true);
  expect(snapshot.files[0]!.includes.map((include) => [include.writtenPath, include.status])).toEqual([['branch.inc', undefined]]);
});

it('takes the first folder that is inside a repository as the current repository', async () => {
  const { root, repo, service } = await sandbox(() => base);
  expect((await inspect(service, root, path.join(repo, 'src'))).repository?.root).toBe(repo);
  // A folder that no longer exists is passed over, not mistaken for Git being missing.
  expect((await inspect(service, path.join(root, 'deleted'), repo)).repository?.root).toBe(repo);
});

it('says so when Git cannot be found', async () => {
  const { repo } = await sandbox(() => base);
  const service = new GitConfigService({
    run: createCliRunner({ platform: process.platform as Platform, timeoutMs: 20_000 }),
    gitPath: () => path.join(repo, 'no-such-git'),
  });
  expect(await service.inspect([repo])).toEqual({ kind: 'gitMissing' });
});
