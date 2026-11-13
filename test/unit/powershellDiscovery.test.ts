import * as fs from 'node:fs/promises';
import { expect, it } from 'vitest';
import { userProfileDirectory, discoverPowerShell, isPreviewInstallation, probeInstallation } from '../../src/powershell/discovery';
it('uses redirected Documents and refuses to guess when it cannot be resolved', () => {
  expect(userProfileDirectory('win32', 'PowerShell 7', {}, 'C:\\Users\\me', 'D:\\Documents'))
    .toBe('D:\\Documents\\PowerShell');
  expect(userProfileDirectory('win32', 'Windows PowerShell', {}, 'C:\\Users\\me'))
    .toBeUndefined();
  expect(userProfileDirectory('linux', 'PowerShell 7', {XDG_CONFIG_HOME: '/config'}, '/home/me'))
    .toBe('/config/powershell');
});

it('rejects relative XDG configuration directories', () => {
  expect(userProfileDirectory('linux','PowerShell 7',{XDG_CONFIG_HOME:'relative'},'/home/me')).toBeUndefined();
});

it('reports an inaccessible installation as a discovery failure rather than absence', async () => {
  const denied = async (): Promise<never> => {throw Object.assign(new Error('access denied'), {code:'EACCES'});};
  const editions = await discoverPowerShell({...fs, stat:denied, readdir:denied});
  expect(editions[0]?.reason).toContain('access denied');
  expect(editions[0]?.reason).not.toBe('Installation not found');
});

it.each([
  ['/home/preview-user/.dotnet/tools/pwsh',false],
  ['C:\\Users\\preview-user\\.dotnet\\tools\\pwsh.exe',false],
  ['/opt/microsoft/powershell/7-preview/pwsh',true],
  ['/opt/homebrew/Caskroom/powershell-preview/7.6/pwsh',true],
])('identifies Preview only from recognized installation segments: %s',(file,preview)=>{
  expect(isPreviewInstallation(file)).toBe(preview);
});
it('requests UTF-8 output for a non-ASCII explicit probe',async()=>{
  let command='';
  const result=await probeInstallation({id:'test',executable:'/test/pwsh'},'PowerShell 7',async (_exe,args)=>{
    command=args.at(-1)!;
    return JSON.stringify({home:'/应用/PowerShell',user:'/用户/李/profile.ps1',major:7,preview:null});
  });
  expect(command).toContain('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)');
  expect(result.userDirectory).toBe('/用户/李');
});
