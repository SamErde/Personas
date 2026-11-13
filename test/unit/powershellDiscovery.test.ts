import * as fs from 'node:fs/promises';
import { expect, it } from 'vitest';
import { userProfileDirectory, registryPersonal, discoverPowerShell } from '../../src/powershell/discovery';
it('uses redirected Documents and refuses to guess when it cannot be resolved', () => {
  expect(userProfileDirectory('win32', 'PowerShell 7', {}, 'C:\\Users\\me', 'D:\\Documents'))
    .toBe('D:\\Documents\\PowerShell');
  expect(userProfileDirectory('win32', 'Windows PowerShell', {}, 'C:\\Users\\me'))
    .toBeUndefined();
  expect(userProfileDirectory('linux', 'PowerShell 7', {XDG_CONFIG_HOME: '/config'}, '/home/me'))
    .toBe('/config/powershell');
});

it('requires absolute registry results and expands redirected Documents without guessing OneDrive', () => {
  expect(registryPersonal('    Personal    REG_EXPAND_SZ    %OneDrive%\\\\Documents', {OneDrive:'D:\\\\Cloud'})).toBe('D:\\\\Cloud\\\\Documents');
  expect(registryPersonal('    Personal    REG_EXPAND_SZ    %Unknown%\\\\Documents', {})).toBeUndefined();
  expect(userProfileDirectory('linux','PowerShell 7',{XDG_CONFIG_HOME:'relative'},'/home/me')).toBeUndefined();
});

it('reports an inaccessible installation as a discovery failure rather than absence', async () => {
  const denied = async (): Promise<never> => {throw Object.assign(new Error('access denied'), {code:'EACCES'});};
  const editions = await discoverPowerShell({...fs, stat:denied, readdir:denied});
  expect(editions[0]?.reason).toContain('access denied');
  expect(editions[0]?.reason).not.toBe('Installation not found');
});
