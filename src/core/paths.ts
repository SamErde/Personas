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
}

function pathFor(platform: Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
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
  const binDirs =
    platform === 'darwin'
      ? [p.join(appRoot, 'bin')]
      : [p.join(appRoot, '..', '..', 'bin'), p.join(appRoot, 'bin')];
  for (const dir of binDirs) {
    for (const name of CLI_NAMES[platform]) {
      const candidate = p.normalize(p.join(dir, name));
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}
