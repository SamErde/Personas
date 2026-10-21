import { describe, expect, it } from 'vitest';
import {
  areFsPathsEqual,
  findCli,
  fsPathKey,
  isFsPathContained,
  normalizeRepoRoot,
  resolvePaths,
} from '../../src/core/paths';

describe('resolvePaths', () => {
  it('derives user data layout from globalStorage path (win32)', () => {
    const p = resolvePaths({
      globalStorageFsPath: 'C:\\Users\\sam\\AppData\\Roaming\\Code\\User\\globalStorage\\samerde.personas',
      extensionFsPath: 'C:\\Users\\sam\\.vscode\\extensions\\samerde.personas-0.1.0',
      platform: 'win32',
    });
    expect(p.userDir).toBe('C:\\Users\\sam\\AppData\\Roaming\\Code\\User');
    expect(p.storageJson).toBe('C:\\Users\\sam\\AppData\\Roaming\\Code\\User\\globalStorage\\storage.json');
    expect(p.profilesDir).toBe('C:\\Users\\sam\\AppData\\Roaming\\Code\\User\\profiles');
    expect(p.userDataDir).toBe('C:\\Users\\sam\\AppData\\Roaming\\Code');
    expect(p.extensionsDir).toBe('C:\\Users\\sam\\.vscode\\extensions');
    expect(p.globalExtensionsJson).toBe('C:\\Users\\sam\\.vscode\\extensions\\extensions.json');
    expect(p.obsoleteFile).toBe('C:\\Users\\sam\\.vscode\\extensions\\.obsolete');
  });

  it('derives layout on posix paths', () => {
    const p = resolvePaths({
      globalStorageFsPath: '/home/sam/.config/Code/User/globalStorage/samerde.personas',
      extensionFsPath: '/home/sam/.vscode/extensions/samerde.personas-0.1.0',
      platform: 'linux',
    });
    expect(p.userDir).toBe('/home/sam/.config/Code/User');
    expect(p.extensionsDir).toBe('/home/sam/.vscode/extensions');
  });
});

describe('findCli', () => {
  it('finds code.cmd two levels above appRoot on windows', () => {
    const appRoot = 'C:\\apps\\VSCode\\resources\\app';
    const expected = 'C:\\apps\\VSCode\\bin\\code.cmd';
    expect(findCli(appRoot, 'win32', (p) => p === expected)).toBe(expected);
  });

  it('finds code.cmd three levels above appRoot when nested under a commit-hash folder (real Windows installs and the @vscode/test-electron archive both use this layout)', () => {
    const appRoot = 'C:\\apps\\VSCode\\4fe60c8b1c\\resources\\app';
    const expected = 'C:\\apps\\VSCode\\bin\\code.cmd';
    expect(findCli(appRoot, 'win32', (p) => p === expected)).toBe(expected);
  });

  it('finds insiders CLI name', () => {
    const appRoot = 'C:\\apps\\Insiders\\resources\\app';
    const expected = 'C:\\apps\\Insiders\\bin\\code-insiders.cmd';
    expect(findCli(appRoot, 'win32', (p) => p === expected)).toBe(expected);
  });

  it('finds macOS CLI inside app bundle', () => {
    const appRoot = '/Applications/Visual Studio Code.app/Contents/Resources/app';
    const expected = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    expect(findCli(appRoot, 'darwin', (p) => p === expected)).toBe(expected);
  });

  it('finds linux CLI two levels above appRoot', () => {
    const appRoot = '/usr/share/code/resources/app';
    const expected = '/usr/share/code/bin/code';
    expect(findCli(appRoot, 'linux', (p) => p === expected)).toBe(expected);
  });

  it('returns undefined when nothing exists', () => {
    expect(findCli('/nowhere/resources/app', 'linux', () => false)).toBeUndefined();
  });
});

describe('fsPath comparison', () => {
  it('treats a filesystem root as containing everything beneath it', () => {
    expect(isFsPathContained('/', '/etc/hosts')).toBe(true);
    expect(isFsPathContained('C:\\', 'c:\\Windows')).toBe(true);
  });

  it('does not treat a sibling sharing a name prefix as contained', () => {
    expect(isFsPathContained('/repo/app', '/repo/app-two')).toBe(false);
  });

  it('honours an explicit platform over the path shape', () => {
    expect(areFsPathsEqual('/Users/Me/App', '/users/me/app')).toBe(false);
    expect(areFsPathsEqual('/Users/Me/App', '/users/me/app', 'darwin')).toBe(true);
  });

  it('keys Windows paths with forward slashes and lower case', () => {
    expect(fsPathKey('C:\\Code\\.\\App\\')).toBe('c:/code/app');
    expect(fsPathKey('\\\\Server\\Share\\Dir')).toBe('//server/share/dir');
  });
});

describe('normalizeRepoRoot', () => {
  const identity = async (p: string) => p;

  it('keys the real path, not the path Git or the workspace reported', async () => {
    const realpath = async (p: string) => (p === '/home/me/link' ? '/srv/repos/app' : p);
    expect(await normalizeRepoRoot('/home/me/link', 'linux', realpath)).toBe('/srv/repos/app');
  });

  it('uses forward slashes, drops trailing separators, and folds case on Windows', async () => {
    expect(await normalizeRepoRoot('C:\\Code\\App\\', 'win32', identity)).toBe('c:/code/app');
    expect(await normalizeRepoRoot('c:/code/APP', 'win32', identity)).toBe('c:/code/app');
  });

  it('folds case on macOS, whose default volumes are case-insensitive', async () => {
    expect(await normalizeRepoRoot('/Users/Me/Code/App/', 'darwin', identity)).toBe('/users/me/code/app');
  });

  it('preserves case on Linux and keeps a backslash as a file-name character', async () => {
    expect(await normalizeRepoRoot('/home/Me/a\\b/', 'linux', identity)).toBe('/home/Me/a\\b');
  });

  it('keeps a filesystem root as the root', async () => {
    expect(await normalizeRepoRoot('/', 'linux', identity)).toBe('/');
    expect(await normalizeRepoRoot('D:\\', 'win32', identity)).toBe('d:/');
  });

  it('normalizes dot segments the real path still carries', async () => {
    expect(await normalizeRepoRoot('/repo/./a/../b', 'linux', identity)).toBe('/repo/b');
  });

  it('rejects a relative path instead of resolving it against the process cwd', async () => {
    await expect(normalizeRepoRoot('repo', 'linux', identity)).rejects.toThrow(/absolute/);
  });
});
