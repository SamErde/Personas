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

  private git(args: string[], cwd: string) {
    const { env } = this.options;
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
      const repository = await this.resolveRepository(folders);
      // Run from the repository root: Git reports the local file relative to where it runs.
      const cwd = repository?.root ?? this.home;
      const listed = await this.git(['config', '--list', '--show-origin', '--show-scope', '-z'], cwd);
      if (listed.code !== 0) return { kind: 'error', message: listed.stderr.trim() || `git exited with code ${listed.code}` };
      const all = parseEntries(listed.stdout, cwd);
      // Without a repository the starting folder decides nothing, so its local values are not shown.
      const entries = repository ? all : all.filter((entry) => entry.scope !== 'local' && entry.scope !== 'worktree');
      return {
        kind: 'ok',
        ...(repository ? { repository } : {}),
        identity: [identityValue(entries, 'user.name'), identityValue(entries, 'user.email')],
        files: await this.files(entries, repository !== undefined, cwd),
        entries,
      };
    } catch (error) {
      if (isMissingExecutable(error)) return { kind: 'gitMissing' };
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async files(entries: GitConfigEntry[], inRepository: boolean, cwd: string): Promise<GitConfigFile[]> {
    const read = new Set(entries.flatMap((entry) => (entry.file ? [pathKey(entry.file)] : [])));
    const included = new Set<string>();
    const includesOf = async (file: string, ancestors: ReadonlySet<string>): Promise<GitConfigInclude[]> => {
      const includes: GitConfigInclude[] = [];
      for (const entry of entries) {
        const match = entry.file && pathKey(entry.file) === pathKey(file) ? includeKey.exec(entry.key) : null;
        if (!match) continue;
        const condition = match[1];
        const target = this.resolveInclude(entry.value, file);
        const key = pathKey(target);
        included.add(key);
        const applied = read.has(key);
        // A conditional rule is only judged against a repository; a plain include always applies.
        const status = condition !== undefined && !inRepository ? undefined : applied ? 'applied' : await this.unreadStatus(target, cwd);
        includes.push({
          ...(condition === undefined ? {} : { condition }),
          writtenPath: entry.value,
          path: target,
          ...(status === undefined ? {} : { status }),
          // Git lists a file's own includes only when it read the file. A cycle ends at its repeat.
          includes: applied && !ancestors.has(key) ? await includesOf(target, new Set([...ancestors, key])) : [],
        });
      }
      return includes;
    };

    const candidates: GitConfigFile[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!entry.file || seen.has(pathKey(entry.file))) continue;
      seen.add(pathKey(entry.file));
      const key = pathKey(entry.file);
      candidates.push({ scope: entry.scope, path: entry.file, includes: await includesOf(entry.file, new Set([key])) });
    }
    // A file reached through an include is shown under its parent, not as a file of its own.
    return candidates.filter((file) => !included.has(pathKey(file.path)));
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
