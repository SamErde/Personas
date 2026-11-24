import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCliRunner } from '../../src/core/cliRunner';
import type { Platform } from '../../src/core/paths';
import { GitConfigService, type GitConfigInclude, type GitConfigSnapshot } from '../../src/git/configService';
import { findGitExecutable } from '../../src/git/executable';

/**
 * Runs real Git against a throwaway repository whose system and global config are isolated, so
 * these tests can disagree with the code about how Git behaves.
 */
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

const slash = (file: string) => file.split('\\').join('/');

const platform = process.platform as Platform;

async function sandbox(globalConfig: (dirs: { home: string; repo: string }) => string, extraEnv: NodeJS.ProcessEnv = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-git-'));
  roots.push(temporary);
  const root = await fs.realpath(temporary);
  const home = path.join(root, 'home');
  const repo = path.join(root, 'repo');
  await fs.mkdir(home);
  await fs.mkdir(path.join(repo, 'src'), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    HOME: home,
    // Config the developer's own environment injects must not reach these tests.
    GIT_CONFIG_COUNT: '0',
    ...extraEnv,
  };
  // Nor a repository it points Git at: `git init` below must create the sandbox's own.
  delete env['GIT_DIR'];
  delete env['GIT_WORK_TREE'];
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
  await fs.writeFile(path.join(home, '.gitconfig'), globalConfig({ home, repo }));
  const service = new GitConfigService({
    run: createCliRunner({ platform, timeoutMs: 20_000 }),
    gitPath: () => findGitExecutable([], { platform, env }),
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

it('with no current repository, leaves out values the environment or command line injects', async () => {
  const { service } = await sandbox(() => base, {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.name',
    GIT_CONFIG_VALUE_0: 'Injected',
  });

  const snapshot = await inspect(service);

  expect(snapshot.identity[0]).toMatchObject({ value: 'Base', scope: 'global' });
  expect(snapshot.entries.map((entry) => entry.scope)).toEqual(['global', 'global']);
});

it('reports a repository Git cannot read as an error, not as no repository', async () => {
  const { repo, service } = await sandbox(() => base);
  await fs.appendFile(path.join(repo, '.git', 'config'), '[broken\n');

  const result = await service.inspect([repo]);

  expect(result.kind).toBe('error');
  expect(result).toMatchObject({ message: expect.stringContaining('bad config') });
});

it('does not take the .git folder itself for a work tree', async () => {
  const { repo, service } = await sandbox(() => base);
  expect((await inspect(service, path.join(repo, '.git'))).repository).toBeUndefined();
});

it('tells a key with no value from a key set to nothing', async () => {
  const { repo, service } = await sandbox(() => `${base}[core]\n\timplicit\n\texplicit =\n`);

  const snapshot = await inspect(service, repo);

  const value = (key: string) => snapshot.entries.find((entry) => entry.key === key)!.value;
  expect(value('core.implicit')).toBeUndefined();
  expect(value('core.explicit')).toBe('');
});

it('judges each include line on its own when several name the same file', async () => {
  const { home, repo, service } = await sandbox(({ repo }) =>
    [
      base,
      '[include]\n\tpath = shared.inc\n',
      '[includeIf "gitdir:/nowhere/"]\n\tpath = shared.inc\n',
      `[includeIf "gitdir:${slash(repo)}/"]\n\tpath = shared.inc\n`,
    ].join(''),
  );
  await fs.writeFile(path.join(home, 'shared.inc'), '[core]\n\teditor = code\n[include]\n\tpath = nested.inc\n');
  await fs.writeFile(path.join(home, 'nested.inc'), '[core]\n\tpager = less\n');

  const snapshot = await inspect(service, repo);

  const nested = [['nested.inc', 'applied', []]];
  const shape = (include: GitConfigInclude): unknown => [include.writtenPath, include.status, include.includes.map(shape)];
  expect(snapshot.files[0]!.includes.map(shape)).toEqual([
    ['shared.inc', 'applied', nested],
    ['shared.inc', 'notApplied', []],
    ['shared.inc', 'applied', nested],
  ]);
});

it('reads the repository of the folder it is given, whatever repository the environment names', async () => {
  const { root, repo, env } = await sandbox(() => base);
  const other = path.join(root, 'other');
  execFileSync('git', ['init', '-q', '-b', 'main', other], { env });
  const inherited = { ...env, GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other };
  const service = new GitConfigService({
    run: createCliRunner({ platform, timeoutMs: 20_000 }),
    gitPath: () => findGitExecutable([], { platform, env: inherited }),
    env: inherited,
  });

  expect((await inspect(service, repo)).repository?.root).toBe(repo);
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
    run: createCliRunner({ platform, timeoutMs: 20_000 }),
    gitPath: () => findGitExecutable([path.join(repo, 'no-such-git')], { platform, env: { PATH: '' } }),
  });
  expect(await service.inspect([repo])).toEqual({ kind: 'gitMissing' });
});
