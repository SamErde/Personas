import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CliRunner } from '../core/cliRunner';
import { fsPathKey, type Platform } from '../core/paths';

/** One value as Git lists it: `git config --list --show-origin --show-scope`. */
export type GitConfigEntry = {
  key: string;
  value: string;
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
  /** The Git executable: VS Code's `git.path` setting when set, otherwise `git` on `PATH`. */
  gitPath: () => string;
  /** Environment for Git; the host's own when omitted. */
  env?: NodeJS.ProcessEnv;
};

/** The folder `~` stands for in a Git config path: `HOME` when set, as Git itself reads it, else the user's home. */
export function gitHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['HOME'] || os.homedir();
}

const includeKey = /^(?:include|includeif\.(.*))\.path$/s;
const pathKey = (file: string) => fsPathKey(file, process.platform as Platform);

/** Splits `git config --list --show-origin --show-scope -z` output: scope, origin, then key and value. */
function parseEntries(stdout: string, cwd: string): GitConfigEntry[] {
  const fields = stdout.split('\0');
  const entries: GitConfigEntry[] = [];
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const scope = fields[i]!;
    const origin = fields[i + 1]!;
    const keyValue = fields[i + 2]!;
    // A key with no value at all (`[section] key`) has no separator.
    const split = keyValue.indexOf('\n');
    const key = split < 0 ? keyValue : keyValue.slice(0, split);
    const value = split < 0 ? '' : keyValue.slice(split + 1);
    const file = origin.startsWith('file:') ? path.resolve(cwd, origin.slice('file:'.length)) : undefined;
    entries.push({ key, value, scope, origin, ...(file === undefined ? {} : { file }) });
  }
  return entries;
}

/** One reading of Git's list, as the file tree is built from it. */
type Listing = {
  entries: readonly GitConfigEntry[];
  /** Keys of the files Git took values from. */
  read: ReadonlySet<string>;
  /** Keys of the files reached through an include, filled in as the tree is built. */
  included: Set<string>;
  inRepository: boolean;
  cwd: string;
};

function isMissingExecutable(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
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

  /**
   * Runs Git in `cwd`. With `discover` off, Git is pointed at a repository that does not exist, so
   * it reads system and global configuration without finding a repository around `cwd`. A home
   * folder that is itself a repository would otherwise decide which `includeIf` rules apply.
   */
  private git(args: string[], cwd: string, discover = true) {
    const base = this.options.env;
    const env = discover ? base : { ...(base ?? process.env), GIT_DIR: path.join(this.home, '.personas-no-repository') };
    return this.options.run(this.options.gitPath(), args, { cwd, ...(env === undefined ? {} : { env }) });
  }

  /** The repository containing `folder`, or undefined when there is none. Throws when Git cannot run. */
  private async findRepository(folder: string): Promise<GitRepository | undefined> {
    // Starting Git in a folder that is gone fails the same way as Git itself being absent.
    if (!(await fs.access(folder).then(() => true, () => false))) return undefined;
    const result = await this.git(['rev-parse', '--show-toplevel', '--absolute-git-dir'], folder);
    const [root, gitDir] = result.stdout.split(/\r?\n/);
    if (result.code !== 0 || !root || !gitDir) return undefined;
    return { name: path.basename(root), root: path.resolve(root), gitDir: path.resolve(gitDir) };
  }

  /** The repository of the first of `folders` that is inside one. Throws when Git cannot run. */
  async resolveRepository(folders: readonly string[]): Promise<GitRepository | undefined> {
    for (const folder of folders) {
      const repository = await this.findRepository(folder);
      if (repository) return repository;
    }
    return undefined;
  }

  /**
   * The configuration in effect for the current repository: that of the first of `folders` inside
   * one. With no repository, system and global configuration only.
   */
  async inspect(folders: readonly string[] = []): Promise<GitConfigResult> {
    try {
      return await this.read(await this.resolveRepository(folders));
    } catch (error) {
      if (isMissingExecutable(error)) return { kind: 'gitMissing' };
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async read(repository: GitRepository | undefined): Promise<GitConfigResult> {
    // Run from the repository root: Git reports the local file relative to where it runs.
    const cwd = repository?.root ?? this.home;
    const listed = await this.git(['config', '--list', '--show-origin', '--show-scope', '-z'], cwd, repository !== undefined);
    if (listed.code !== 0) return { kind: 'error', message: listed.stderr.trim() || `git exited with code ${listed.code}` };
    const entries = parseEntries(listed.stdout, cwd);
    return {
      kind: 'ok',
      ...(repository ? { repository } : {}),
      identity: [identityValue(entries, 'user.name'), identityValue(entries, 'user.email')],
      files: await this.files({
        entries,
        read: new Set(entries.flatMap((entry) => (entry.file ? [pathKey(entry.file)] : []))),
        included: new Set(),
        inRepository: repository !== undefined,
        cwd,
      }),
      entries,
    };
  }

  private async files(listing: Listing): Promise<GitConfigFile[]> {
    const candidates: GitConfigFile[] = [];
    const seen = new Set<string>();
    for (const entry of listing.entries) {
      if (!entry.file || seen.has(pathKey(entry.file))) continue;
      const key = pathKey(entry.file);
      seen.add(key);
      candidates.push({ scope: entry.scope, path: entry.file, includes: await this.includesOf(entry.file, new Set([key]), listing) });
    }
    // A file reached through an include is shown under its parent, not as a file of its own.
    return candidates.filter((file) => !listing.included.has(pathKey(file.path)));
  }

  /** The includes `file` names, in Git's order. `ancestors` are the files above it, so a cycle ends at its repeat. */
  private async includesOf(file: string, ancestors: ReadonlySet<string>, listing: Listing): Promise<GitConfigInclude[]> {
    const fileKey = pathKey(file);
    const includes: GitConfigInclude[] = [];
    for (const entry of listing.entries) {
      if (!entry.file || pathKey(entry.file) !== fileKey) continue;
      const rule = includeKey.exec(entry.key);
      if (!rule) continue;
      const condition = rule[1];
      const target = this.resolveInclude(entry.value, file);
      const key = pathKey(target);
      listing.included.add(key);
      const status = await this.includeStatus(target, condition, listing);
      // Git lists a file's own includes only when it read the file.
      const nested = listing.read.has(key) && !ancestors.has(key);
      includes.push({
        ...(condition === undefined ? {} : { condition }),
        writtenPath: entry.value,
        path: target,
        ...(status === undefined ? {} : { status }),
        includes: nested ? await this.includesOf(target, new Set([...ancestors, key]), listing) : [],
      });
    }
    return includes;
  }

  /** A conditional rule is only judged against a repository; a plain include always applies. */
  private async includeStatus(target: string, condition: string | undefined, listing: Listing): Promise<GitIncludeStatus | undefined> {
    if (condition !== undefined && !listing.inRepository) return undefined;
    if (listing.read.has(pathKey(target))) return 'applied';
    return this.unreadStatus(target, listing.cwd);
  }

  /** Tells apart the files Git did not take values from: no values in effect, no values at all, or no file. */
  private async unreadStatus(target: string, cwd: string): Promise<GitIncludeStatus> {
    const result = await this.git(['config', '--file', target, '--list'], cwd);
    if (result.code === 0) return result.stdout.trim() === '' ? 'empty' : 'notApplied';
    const exists = await fs.access(target).then(() => true, () => false);
    return exists ? 'notApplied' : 'missing';
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
  return { key, value: entry.value, scope: entry.scope, ...(entry.file === undefined ? {} : { file: entry.file }) };
}
