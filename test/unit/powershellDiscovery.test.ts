import { expect, it } from 'vitest';
import { userProfileDirectory, registryPersonal } from '../../src/powershell/discovery';
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
