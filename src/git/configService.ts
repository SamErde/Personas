import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CliResult, CliRunner } from '../core/cliRunner';
import { fsPathKey, type Platform } from '../core/paths';

/** One value as Git lists it: `git config --list --show-origin --show-scope`. */
export type GitConfigEntry = {
  key: string;
  /** Undefined when the key is written with no value at all (`[section] key`), which Git reads as true. */
  value: string | undefined;
  /** Git's own scope name: system, global, local, worktree or command. */
  scope: string;
  /** The origin as Git prints it, for example `file:.git/config` or `command line:`. */
  origin: string;
  /** The absolute path of the origin, when the origin is a file. */
  file?: string;
};

/**
 * Whether an included file takes part in the effective configuration. Inferred from Git's own
 * output: Personas does not evaluate `includeIf` conditions itself.
 */
export type GitIncludeStatus = 'applied' | 'notApplied' | 'empty' | 'missing';

export type GitConfigInclude = {
  /** The `includeIf` condition as written, for example `gitdir:~/work/`. Absent for a plain `include`. */
  condition?: string;
  /** The target as written in the including file. */
  writtenPath: string;
  /** The target resolved against the including file's folder, with `~` expanded. */
  path: string;
  /** Absent when no claim can be made: an `includeIf` rule with no current repository. */
  status?: GitIncludeStatus;
  includes: GitConfigInclude[];
};

export type GitConfigFile = { scope: string; path: string; includes: GitConfigInclude[] };

export type GitIdentityValue = { key: 'user.name' | 'user.email'; value?: string; scope?: string; file?: string };

export type GitRepository = { name: string; root: string; gitDir: string };

export type GitConfigSnapshot = {
  kind: 'ok';
  /** Absent when the inspected folder is not inside a repository. */
  repository?: GitRepository;
  identity: GitIdentityValue[];
  /** The files that hold values, by scope, each with its includes nested under it. */
  files: GitConfigFile[];
  /** Every value in the order Git reads it. */
  entries: GitConfigEntry[];
};

export type GitConfigResult = GitConfigSnapshot | { kind: 'gitMissing' } | { kind: 'error'; message: string };

export type GitConfigServiceOptions = {
  run: CliRunner;
  /** The absolute path of the Git executable, or undefined when there is none. See `findGitExecutable`. */
  gitPath: () => Promise<string | undefined>;
  /** Environment for Git; the host's own when omitted. */
  env?: NodeJS.ProcessEnv;
};

/** The folder `~` stands for in a Git config path: `HOME` when set, as Git itself reads it, else the user's home. */
export function gitHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['HOME'] || os.homedir();
}

const includeKey = /^(?:include|includeif\.(.*))\.path$/s;
const pathKey = (file: string) => fsPathKey(file, process.platform as Platform);
const exists = (file: string) => fs.access(file).then(() => true, () => false);
/** How many `git config --file` reads run at once. */
const statusReadsAtOnce = 8;

/** Environment variables that tell Git which repository to use, whatever folder it runs in. */
const repositoryOverrides = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_NAMESPACE'];

class GitMissingError extends Error {}

/** Runs Git in `cwd`. With `discover` off, Git does not look for a repository around `cwd`. */
type GitRun = (args: string[], cwd: string, discover?: boolean) => Promise<CliResult>;

/** Splits `git config --list --show-origin --show-scope -z` output: scope, origin, then key and value. */
function parseEntries(stdout: string, cwd: string): GitConfigEntry[] {
  const fields = stdout.split('\0');
  const entries: GitConfigEntry[] = [];
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const scope = fields[i]!;
    const origin = fields[i + 1]!;
    const keyValue = fields[i + 2]!;
    // Git separates key and value with a newline, and leaves it out for a key with no value at all.
    const split = keyValue.indexOf('\n');
    const key = split < 0 ? keyValue : keyValue.slice(0, split);
    const value = split < 0 ? undefined : keyValue.slice(split + 1);
    const file = origin.startsWith('file:') ? path.resolve(cwd, origin.slice('file:'.length)) : undefined;
    entries.push({ key, value, scope, origin, ...(file === undefined ? {} : { file }) });
  }
  return entries;
}

/** One `include` or `includeIf` line as Git came to it. A file included twice has two. */
type Occurrence = { include: GitConfigInclude; key: string; applied: boolean };

/** A config file Git is in the middle of reading. */
type Frame = { key: string; includes: GitConfigInclude[]; pending?: Occurrence };

/** The frame `entry` belongs to, given the files Git has open: the same file, a file just included, or one further up. */
function enter(stack: Frame[], roots: GitConfigFile[], entry: GitConfigEntry & { file: string }): Frame {
  const key = pathKey(entry.file);
  const top = stack.at(-1);
  if (top?.key === key) return top;
  if (top?.pending?.key === key) {
    // Git reads an included file straight after the line that names it.
    top.pending.applied = true;
    const frame: Frame = { key, includes: top.pending.include.includes };
    stack.push(frame);
    return frame;
  }
  while (stack.length > 0 && stack.at(-1)!.key !== key) stack.pop();
  const open = stack.at(-1);
  if (open) return open;
  const root: GitConfigFile = { scope: entry.scope, path: entry.file, includes: [] };
  roots.push(root);
  const frame: Frame = { key, includes: root.includes };
  stack.push(frame);
  return frame;
}

/**
 * Rebuilds the files Git read and the includes each names, from the order of its list: Git lists
 * a file's values up to an include line, then the included file's values if it read that file,
 * then the rest. So each include line is judged on its own, even when two name the same file.
 */
function buildFileTree(
  entries: readonly GitConfigEntry[],
  resolveInclude: (written: string, includingFile: string) => string,
): { files: GitConfigFile[]; occurrences: Occurrence[] } {
  const files: GitConfigFile[] = [];
  const occurrences: Occurrence[] = [];
  const stack: Frame[] = [];
  for (const entry of entries) {
    if (entry.file === undefined) continue;
    const frame = enter(stack, files, { ...entry, file: entry.file });
    delete frame.pending;
    const rule = includeKey.exec(entry.key);
    if (!rule || entry.value === undefined) continue;
    const condition = rule[1];
    const target = resolveInclude(entry.value, entry.file);
    const include: GitConfigInclude = {
      ...(condition === undefined ? {} : { condition }),
      writtenPath: entry.value,
      path: target,
      includes: [],
    };
    frame.includes.push(include);
    frame.pending = { include, key: pathKey(target), applied: false };
    occurrences.push(frame.pending);
  }
  return { files, occurrences };
}

/** Whether `folder` or a folder above it holds a `.git` entry, so Git should have found a repository there. */
async function hasGitEntryAbove(folder: string): Promise<boolean> {
  for (let current = path.resolve(folder); ; current = path.dirname(current)) {
    if (await exists(path.join(current, '.git'))) return true;
    if (path.dirname(current) === current) return false;
  }
}

/**
 * Reads Git configuration through the `git` CLI and never writes it. Built for the Git
 * Configuration view, and meant to serve a later Git identity audit too.
 */
export class GitConfigService {
  private readonly home: string;

  constructor(private readonly options: GitConfigServiceOptions) {
    this.home = gitHome(options.env);
  }

  /** Resolves the Git executable once, for all the commands of one read. */
  private async session(): Promise<GitRun> {
    const executable = await this.options.gitPath();
    if (executable === undefined) throw new GitMissingError();
    // An inherited repository location would answer for whatever folder Git is run in.
    const base = { ...(this.options.env ?? process.env) };
    for (const name of repositoryOverrides) delete base[name];
    // Pointed at a repository that does not exist, Git reads system and global configuration
    // without finding one around `cwd`. A home folder that is itself a repository would
    // otherwise decide which `includeIf` rules apply.
    const outside = { ...base, GIT_DIR: path.join(this.home, '.personas-no-repository') };
    return (args, cwd, discover = true) => this.options.run(executable, args, { cwd, env: discover ? base : outside });
  }

  /**
   * The repository whose work tree contains `folder`, or undefined when there is none. Throws
   * when a repository is there and Git cannot read it, so a broken one is not passed off as absent.
   */
  private async findRepository(git: GitRun, folder: string): Promise<GitRepository | undefined> {
    // Starting Git in a folder that is gone fails the same way as Git itself being absent.
    if (!(await exists(folder))) return undefined;
    const result = await git(['rev-parse', '--absolute-git-dir', '--show-toplevel'], folder);
    const [gitDir, root] = result.stdout.split(/\r?\n/);
    if (result.code === 0 && gitDir && root) {
      return { name: path.basename(root), root: path.resolve(root), gitDir: path.resolve(gitDir) };
    }
    // Git found a repository but no work tree: the folder is inside the `.git` folder itself.
    if (gitDir) return undefined;
    if (await hasGitEntryAbove(folder)) throw new Error(result.stderr.trim() || 'Git could not read this repository.');
    return undefined;
  }

  private async firstRepository(git: GitRun, folders: readonly string[]): Promise<GitRepository | undefined> {
    for (const folder of folders) {
      const repository = await this.findRepository(git, folder);
      if (repository) return repository;
    }
    return undefined;
  }

  /** The repository of the first of `folders` that is inside one. Throws when Git cannot run or cannot read it. */
  async resolveRepository(folders: readonly string[]): Promise<GitRepository | undefined> {
    return this.firstRepository(await this.session(), folders);
  }

  /**
   * The configuration in effect for the current repository: that of the first of `folders` inside
   * one. With no repository, system and global configuration only.
   */
  async inspect(folders: readonly string[] = []): Promise<GitConfigResult> {
    try {
      const git = await this.session();
      return await this.read(git, await this.firstRepository(git, folders));
    } catch (error) {
      if (error instanceof GitMissingError || (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        return { kind: 'gitMissing' };
      }
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async read(git: GitRun, repository: GitRepository | undefined): Promise<GitConfigResult> {
    // Run from the repository root: Git reports the local file relative to where it runs.
    const cwd = repository?.root ?? this.home;
    const listed = await git(['config', '--list', '--show-origin', '--show-scope', '-z'], cwd, repository !== undefined);
    if (listed.code !== 0) return { kind: 'error', message: listed.stderr.trim() || `git exited with code ${listed.code}` };
    const all = parseEntries(listed.stdout, cwd);
    // With no repository only system and global configuration is shown: not what the command line
    // or the environment (`GIT_CONFIG_COUNT`) adds, which Git reports under the command scope.
    const entries = repository ? all : all.filter((entry) => entry.scope === 'system' || entry.scope === 'global');
    const tree = buildFileTree(entries, (written, includingFile) => this.resolveInclude(written, includingFile));
    await this.setStatuses(git, tree.occurrences, repository !== undefined, cwd);
    return {
      kind: 'ok',
      ...(repository ? { repository } : {}),
      identity: [identityValue(entries, 'user.name'), identityValue(entries, 'user.email')],
      files: tree.files,
      entries,
    };
  }

  /** A conditional rule is only judged against a repository; a plain include always applies. */
  private async setStatuses(git: GitRun, occurrences: readonly Occurrence[], inRepository: boolean, cwd: string): Promise<void> {
    const judged = occurrences.filter((occurrence) => inRepository || occurrence.include.condition === undefined);
    // Each file Git did not read is asked about once, however many lines name it.
    const unread = [...new Map(judged.filter((o) => !o.applied).map((o) => [o.key, o.include.path])).entries()];
    const statuses = new Map<string, GitIncludeStatus>();
    for (let i = 0; i < unread.length; i += statusReadsAtOnce) {
      const batch = unread.slice(i, i + statusReadsAtOnce);
      await Promise.all(batch.map(async ([key, target]) => statuses.set(key, await this.unreadStatus(git, target, cwd))));
    }
    for (const occurrence of judged) {
      const status = occurrence.applied ? 'applied' : statuses.get(occurrence.key);
      if (status !== undefined) occurrence.include.status = status;
    }
  }

  /** Tells apart the files Git did not take values from: no values in effect, no values at all, or no file. */
  private async unreadStatus(git: GitRun, target: string, cwd: string): Promise<GitIncludeStatus> {
    const result = await git(['config', '--file', target, '--list'], cwd);
    if (result.code === 0) return result.stdout.trim() === '' ? 'empty' : 'notApplied';
    return (await exists(target)) ? 'notApplied' : 'missing';
  }

  private resolveInclude(written: string, includingFile: string): string {
    if (written === '~' || written.startsWith('~/')) return path.join(this.home, written.slice(2));
    return path.resolve(path.dirname(includingFile), written);
  }
}

function identityValue(entries: readonly GitConfigEntry[], key: GitIdentityValue['key']): GitIdentityValue {
  // The last value Git reads is the one in effect.
  const entry = entries.filter((candidate) => candidate.key === key).at(-1);
  if (!entry) return { key };
  return {
    key,
    ...(entry.value === undefined ? {} : { value: entry.value }),
    scope: entry.scope,
    ...(entry.file === undefined ? {} : { file: entry.file }),
  };
}
