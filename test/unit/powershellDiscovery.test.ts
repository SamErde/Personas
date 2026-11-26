import * as fs from 'node:fs/promises';
import * as os from 'node:os';
vi.mock('node:os', {spy:true});
import { expect, it, vi } from 'vitest';
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

it('uses the Windows user profile for .NET tools even when HOME points elsewhere',async()=>{
  const seen:string[]=[];
  const platform=vi.spyOn(process,'platform','get').mockReturnValue('win32');
  const home=vi.spyOn(os,'homedir').mockReturnValue('C:\\Users\\me');
  vi.stubEnv('HOME','D:\\git-home'); vi.stubEnv('USERPROFILE','C:\\Users\\me');
  vi.stubEnv('SystemRoot','');
  try {
    await discoverPowerShell({...fs,readdir:async()=>[] as never,stat:async file=>{
      seen.push(String(file)); throw Object.assign(new Error('missing'),{code:'ENOENT'});
    }});
    expect(seen.some(file=>file.replaceAll('\\','/').endsWith('C:/Users/me/.dotnet/tools/pwsh.exe'))).toBe(true);
    expect(seen.some(file=>file.includes('git-home'))).toBe(false);
  } finally {platform.mockRestore();home.mockRestore();vi.unstubAllEnvs();}
});

it.each(['/opt/homebrew','/usr/local'])('discovers the Homebrew LTS launcher under %s and resolves its installation root',async prefix=>{
  const launcher=prefix+'/bin/pwsh-lts', libexec=prefix+'/Cellar/powershell-lts/7.4.0/libexec';
  const posix=(file:unknown)=>String(file).replaceAll('\\','/');
  const platform=vi.spyOn(process,'platform','get').mockReturnValue('darwin');
  try {
    const editions=await discoverPowerShell({...fs,
      stat:async file=>{
        if([launcher,libexec+'/System.Management.Automation.dll'].includes(posix(file))) return {isFile:()=>true} as never;
        throw Object.assign(new Error('missing'),{code:'ENOENT'});
      },
      realpath:async file=>(posix(file)===launcher ? libexec+'/pwsh' : String(file)) as never,
    });
    expect(editions[0]?.installations.map(i=>[posix(i.executable),posix(i.home)])).toEqual([[libexec+'/pwsh',libexec]]);
    expect(editions[0]?.reason).toBeUndefined();
  } finally {platform.mockRestore();}
});

it('uses the system folders as Windows PowerShell homes while a .NET tool shim stays unresolved',async()=>{
  const posix=(file:unknown)=>String(file).replaceAll('\\','/');
  const platform=vi.spyOn(process,'platform','get').mockReturnValue('win32');
  const home=vi.spyOn(os,'homedir').mockReturnValue('X:\\Users\\me');
  // No drive X: exists, so the Documents lookup cannot start reg.exe on any platform.
  vi.stubEnv('SystemRoot','X:\\Windows'); vi.stubEnv('LOCALAPPDATA','X:\\Local');
  const executables=['System32','SysWOW64'].map(system=>'X:/Windows/'+system+'/WindowsPowerShell/v1.0/powershell.exe');
  const shim='X:/Users/me/.dotnet/tools/pwsh.exe';
  try {
    // Only the executables exist: no System.Management.Automation.dll sits beside any of them.
    const editions=await discoverPowerShell({...fs,readdir:async()=>[] as never,
      stat:async file=>{
        if([...executables,shim].includes(posix(file))) return {isFile:()=>true} as never;
        throw Object.assign(new Error('missing'),{code:'ENOENT'});
      },
      realpath:async file=>String(file) as never,
    });
    const inspected: string[] = [];
    const included = await discoverPowerShell({...fs, readdir:async()=>[] as never,
      stat:async file=>{
        inspected.push(posix(file));
        throw Object.assign(new Error('missing'), {code:'ENOENT'});
      },
    }, false);
    expect(included.map(item=>item.edition)).toEqual(['PowerShell 7']);
    expect(inspected.some(file=>executables.includes(file))).toBe(false);

    const windows=editions.find(edition=>edition.edition==='Windows PowerShell');
    expect(windows?.installations.map(i=>posix(i.home))).toEqual(executables.map(file=>file.replace('/powershell.exe','')));
    const seven=editions.find(edition=>edition.edition==='PowerShell 7');
    expect(seven?.installations.map(i=>[posix(i.executable),i.home])).toEqual([[shim,undefined]]);
  } finally {platform.mockRestore();home.mockRestore();vi.unstubAllEnvs();}
});

/** Windows with only the Microsoft Store alias, which stat cannot follow (EACCES) but readlink can. */
async function discoverThroughStoreAlias(target:string,targetFiles:string[]){
  const posix=(file:unknown)=>String(file).replaceAll('\\','/');
  const alias='X:/Local/Microsoft/WindowsApps/pwsh.exe';
  const platform=vi.spyOn(process,'platform','get').mockReturnValue('win32');
  const home=vi.spyOn(os,'homedir').mockReturnValue('X:\\Users\\me');
  // No drive X: exists, so the Documents lookup cannot start reg.exe on any platform.
  vi.stubEnv('SystemRoot','X:\\Windows'); vi.stubEnv('LOCALAPPDATA','X:\\Local');
  try {
    const editions=await discoverPowerShell({...fs,readdir:async()=>[] as never,
      stat:async file=>{
        if(posix(file)===alias) throw Object.assign(new Error('access denied'),{code:'EACCES'});
        if(targetFiles.includes(posix(file))) return {isFile:()=>true} as never;
        throw Object.assign(new Error('missing'),{code:'ENOENT'});
      },
      readlink:async file=>{
        if(posix(file)===alias) return target as never;
        throw Object.assign(new Error('not a link'),{code:'EINVAL'});
      },
      realpath:async file=>String(file) as never,
    });
    const seven=editions.find(edition=>edition.edition==='PowerShell 7');
    return {alias,reason:seven?.reason,installations:seven?.installations.map(i=>[posix(i.executable),i.home&&posix(i.home),i.readOnly])};
  } finally {platform.mockRestore();home.mockRestore();vi.unstubAllEnvs();}
}

it('follows the Microsoft Store alias to its read-only PowerShell 7 home and keeps the alias as the launcher',async()=>{
  const packaged='X:/Program Files/WindowsApps/Microsoft.PowerShell_7.5.0.0_x64__8wekyb3d8bbwe';
  const result=await discoverThroughStoreAlias(packaged+'/pwsh.exe',[packaged+'/pwsh.exe',packaged+'/System.Management.Automation.dll']);
  expect(result.installations).toEqual([[result.alias,packaged,true]]);
  expect(result.reason).not.toContain('access denied');
});

it('keeps a Microsoft Store alias to PowerShell Preview out of scope',async()=>{
  const packaged='X:/Program Files/WindowsApps/Microsoft.PowerShellPreview_7.6.0.0_x64__8wekyb3d8bbwe';
  const result=await discoverThroughStoreAlias(packaged+'/pwsh.exe',[packaged+'/pwsh.exe',packaged+'/System.Management.Automation.dll']);
  expect(result.installations).toEqual([]);
  expect(result.reason).toBe('Installation not found');
});

it('still reports the access failure when a Microsoft Store alias leads nowhere readable',async()=>{
  const result=await discoverThroughStoreAlias('X:/Program Files/WindowsApps/Microsoft.PowerShell_7.5.0.0_x64__8wekyb3d8bbwe/pwsh.exe',[]);
  expect(result.installations).toEqual([]);
  expect(result.reason).toContain('access denied');
});
