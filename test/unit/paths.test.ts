import { describe, expect, it } from 'vitest';
import { findCli, resolvePaths } from '../../src/core/paths';

describe('resolvePaths', () => {
  it('derives user data layout from globalStorage path (win32)', () => {
    const p = resolvePaths({
      globalStorageFsPath: 'C:\\Users\\sam\\AppData\\Roaming\\Code\\User\\globalStorage\\samerde.visex',
      extensionFsPath: 'C:\\Users\\sam\\.vscode\\extensions\\samerde.visex-0.1.0',
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
      globalStorageFsPath: '/home/sam/.config/Code/User/globalStorage/samerde.visex',
      extensionFsPath: '/home/sam/.vscode/extensions/samerde.visex-0.1.0',
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
