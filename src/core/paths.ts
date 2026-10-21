import * as path from 'node:path';

export type Platform = 'win32' | 'darwin' | 'linux';

export interface PathInput {
  /** context.globalStorageUri.fsPath — …/User/globalStorage/<publisher.name> */
  globalStorageFsPath: string;
  /** context.extension.extensionUri.fsPath — …/extensions/<publisher.name>-<version>. Locates the extensions pool. */
  extensionFsPath: string;
  platform: Platform;
}

export interface ResolvedPaths {
  userDataDir: string; // e.g. …/Code
  userDir: string; // …/Code/User
  storageJson: string;
  profilesDir: string;
  extensionsDir: string;
  globalExtensionsJson: string;
  obsoleteFile: string;
  /** Path syntax of every path above. */
  platform: Platform;
}

export function pathFor(platform: Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Platforms whose default file systems ignore case, matching VS Code's own path comparison. */
function ignoresCase(platform: Platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

/**
 * The platform a native fsPath's syntax belongs to, judged from its shape: a drive letter or UNC
 * prefix means win32; anything else is treated as case-sensitive POSIX. Only for code handed
 * fsPaths without the host platform (workspace descriptors, runtime extension paths) — code that
 * knows the platform passes it instead.
 */
export function inferFsPathPlatform(fsPath: string): Platform {
  return /^[a-z]:[\\/]/i.test(fsPath) || /^\\\\/.test(fsPath) ? 'win32' : 'linux';
}

/** Joins onto a native fsPath using the syntax of that path (see inferFsPathPlatform). */
export function joinFsPath(base: string, ...parts: string[]): string {
  return pathFor(inferFsPathPlatform(base)).join(base, ...parts);
}

/** Parent directory of a native fsPath, using the syntax of that path (see inferFsPathPlatform). */
export function dirnameFsPath(fsPath: string): string {
  return pathFor(inferFsPathPlatform(fsPath)).dirname(fsPath);
}

/**
 * Comparison key for a native fsPath: resolved (dot segments and trailing separators removed,
 * a root kept as the root), forward slashes on Windows, and lower case where the platform's file
 * system ignores case. Keys are for comparing and storing, never for opening files.
 */
export function fsPathKey(fsPath: string, platform: Platform = inferFsPathPlatform(fsPath)): string {
  const resolved = pathFor(platform).resolve(fsPath);
  const slashed = platform === 'win32' ? resolved.replaceAll('\\', '/') : resolved;
  return ignoresCase(platform) ? slashed.toLowerCase() : slashed;
}

export function areFsPathsEqual(a: string, b: string, platform?: Platform): boolean {
  return fsPathKey(a, platform) === fsPathKey(b, platform);
}

/** True when child is parent itself or lies beneath it (a sibling sharing a name prefix does not). */
export function isFsPathContained(parent: string, child: string, platform?: Platform): boolean {
  const parentKey = fsPathKey(parent, platform);
  const childKey = fsPathKey(child, platform);
  const prefix = parentKey.endsWith('/') ? parentKey : `${parentKey}/`;
  return childKey === parentKey || childKey.startsWith(prefix);
}

/**
 * The binding key for a Git repository root (Git identity spec, RepoPersonaBinding.repoRoot):
 * the absolute real path, so symlinks and alternate openings of one checkout share a key, then
 * fsPathKey's separator, trailing-separator and case normalization. Pass fs.promises.realpath as
 * `realpath`. A relative path is rejected rather than resolved against the process cwd.
 */
export async function normalizeRepoRoot(
  repoRoot: string,
  platform: Platform,
  realpath: (p: string) => Promise<string>,
): Promise<string> {
  if (!pathFor(platform).isAbsolute(repoRoot)) {
    throw new Error(`Repository root must be an absolute path: ${repoRoot}`);
  }
  return fsPathKey(await realpath(repoRoot), platform);
}

/**
 * A file-system watcher target: a directory plus a glob relative to it. Recursive watching only
 * happens when the pattern asks for it, so targets name the files they care about.
 */
export interface WatchTarget {
  baseFsPath: string;
  pattern: string;
  /** When set, the broad pattern is only a transport for file events; callers must refresh only
   *  when the changed path equals this literal path. This avoids treating manifest filenames as
   *  glob syntax. */
  exactFsPath?: string;
}

export function resolvePaths(input: PathInput): ResolvedPaths {
  const p = pathFor(input.platform);
  const userDir = p.dirname(p.dirname(input.globalStorageFsPath));
  const extensionsDir = p.dirname(input.extensionFsPath);
  return {
    userDataDir: p.dirname(userDir),
    userDir,
    storageJson: p.join(userDir, 'globalStorage', 'storage.json'),
    profilesDir: p.join(userDir, 'profiles'),
    extensionsDir,
    globalExtensionsJson: p.join(extensionsDir, 'extensions.json'),
    obsoleteFile: p.join(extensionsDir, '.obsolete'),
    platform: input.platform,
  };
}

const CLI_NAMES: Record<Platform, string[]> = {
  win32: ['code.cmd', 'code-insiders.cmd', 'codium.cmd'],
  darwin: ['code', 'code-insiders', 'codium'],
  linux: ['code', 'code-insiders', 'codium'],
};

/**
 * appRoot is <install>/resources/app (win/linux) or <bundle>/Contents/Resources/app (mac).
 * The CLI lives at <install>/bin/<name> (win/linux) or <appRoot>/bin/<name> (mac).
 */
export function findCli(
  appRoot: string,
  platform: Platform,
  exists: (p: string) => boolean,
): string | undefined {
  const p = pathFor(platform);
  let binDirs: string[];
  if (platform === 'darwin') {
    binDirs = [p.join(appRoot, 'bin')];
  } else if (platform === 'win32') {
    // Modern Windows installs (and the @vscode/test-electron archive distribution — verified
    // identical, same commit-hash folder name) nest resources/app three levels below the
    // install root, inside a commit-hash folder that sits alongside bin/. Try that first, then
    // fall back to the flatter two-level layout in case some Windows distribution uses it.
    binDirs = [
      p.join(appRoot, '..', '..', '..', 'bin'),
      p.join(appRoot, '..', '..', 'bin'),
      p.join(appRoot, 'bin'),
    ];
  } else {
    binDirs = [p.join(appRoot, '..', '..', 'bin'), p.join(appRoot, 'bin')];
  }
  for (const dir of binDirs) {
    for (const name of CLI_NAMES[platform]) {
      const candidate = p.normalize(p.join(dir, name));
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}
