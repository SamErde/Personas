import { expect, it, vi } from 'vitest';
import { PowerShellService } from '../../src/powershell/service';
import type { EditionInfo } from '../../src/powershell/profiles';

const runtimeAllowed = { allowRuntimeDiscovery:true, includeWindowsPowerShell:true };

it('returns passive inventory before background profile resolution settles', async () => {
  let finish!: (value:{home:string;userDirectory:string}) => void;
  const probe = vi.fn(() => new Promise<{home:string;userDirectory:string}>(resolve => { finish=resolve; }));
  const service = new PowerShellService(async () => [{
    edition:'PowerShell 7',
    installations:[{id:'pwsh',executable:'C:\\Program Files\\PowerShell\\7\\pwsh.exe',home:'C:\\Program Files\\PowerShell\\7'}],
  }], probe, 'win32');

  const refresh = await service.refresh(runtimeAllowed);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(refresh.initial.rows.find(row => row.scope === 'Current User')?.state).toBe('unresolved');

  finish({home:'C:\\Program Files\\PowerShell\\7',userDirectory:'D:\\Documents\\PowerShell'});
  const settled = await refresh.settled;
  expect(settled?.rows.find(row => row.scope === 'Current User' && row.host === 'All Hosts')?.path)
    .toBe('D:\\Documents\\PowerShell\\profile.ps1');
});

it('requires explicit runtime permission and retains confirmed paths when permission is withdrawn', async () => {
  const discover = async (): Promise<EditionInfo[]> => [{
    edition: 'PowerShell 7', installations: [{id:'pwsh', executable:'/test/pwsh'}],
  }];
  const probe = vi.fn(async () => ({home:'/resolved', userDirectory:'/user/powershell'}));
  const service = new PowerShellService(discover, probe, 'linux', async () => true);
  const runtimeOff = {...runtimeAllowed, allowRuntimeDiscovery:false};
  await service.refresh();
  await expect(service.resolve('pwsh', runtimeOff)).rejects.toThrow('off');
  await service.refresh();
  expect(probe).not.toHaveBeenCalled();

  await service.resolve('pwsh', runtimeAllowed);
  await service.refresh();
  await expect(service.resolve('pwsh', runtimeOff)).rejects.toThrow('off');
  await service.refresh();
  expect(probe).toHaveBeenCalledTimes(1);
  expect(service.snapshot.rows.find(r=>r.host==='Console' && r.scope==='Current User')?.path).toBe('/user/powershell/Microsoft.PowerShell_profile.ps1');
  expect(service.snapshot.rows.find(r=>r.host==='Console' && r.scope==='All Users')?.path).toBe('/resolved/Microsoft.PowerShell_profile.ps1');
});
it('keeps unresolved paths after a failed probe and rejects unknown installation IDs', async () => {
  const probe=vi.fn(async()=>{throw new Error('timeout');});
  const service=new PowerShellService(async()=>[{edition:'PowerShell 7',installations:[{id:'pwsh',executable:'/test/pwsh'}]}],probe,'linux');
  await service.refresh();
  await expect(service.resolve('forged', runtimeAllowed)).rejects.toThrow('no longer available');
  expect(probe).not.toHaveBeenCalled();
  await expect(service.resolve('pwsh', runtimeAllowed)).rejects.toThrow('timeout');
  await service.refresh();
  expect(service.snapshot.rows.every(r=>r.state==='unresolved')).toBe(true);
});
it('prefers a newly discovered installation home over the cached probe result', async () => {
  // A Microsoft Store update replaces the package folder while the launcher alias stays the same.
  let home='/package-1';
  const discover = async (): Promise<EditionInfo[]> => [{
    edition:'PowerShell 7', installations:[{id:home,executable:'/alias/pwsh',home}],
  }];
  const probe = vi.fn(async () => ({home:'/package-1',userDirectory:'/user/powershell'}));
  const service = new PowerShellService(discover,probe,'linux');
  await service.refresh(); await service.resolve('/package-1', runtimeAllowed);
  home='/package-2'; await service.refresh();
  expect(probe).toHaveBeenCalledTimes(1);
  expect(service.snapshot.rows.find(r=>r.host==='Console' && r.scope==='All Users')?.path).toBe('/package-2/Microsoft.PowerShell_profile.ps1');
  expect(service.snapshot.rows.find(r=>r.host==='Console' && r.scope==='Current User')?.path).toBe('/user/powershell/Microsoft.PowerShell_profile.ps1');
});
it('drops a cached probe result once its home no longer holds PowerShell and offers resolution again', async () => {
  // Updating a .NET global tool keeps the launcher shim while its versioned home is replaced.
  const homes=['/tool-1','/tool-2'];
  const probe = vi.fn(async () => ({home:homes[probe.mock.calls.length-1]!,userDirectory:'/user/powershell'}));
  const service = new PowerShellService(async()=>[{
    edition:'PowerShell 7', installations:[{id:'/shim/pwsh',executable:'/shim/pwsh'}],
  }],probe,'linux',async home=>home===homes[probe.mock.calls.length-1]);
  const allUsers=()=>service.snapshot.rows.find(r=>r.host==='Console' && r.scope==='All Users');
  await service.refresh(); await service.resolve('/shim/pwsh', runtimeAllowed); await service.refresh();
  expect(allUsers()?.path).toBe('/tool-1/Microsoft.PowerShell_profile.ps1');
  homes[0]='/removed'; await service.refresh();
  expect(allUsers()?.state).toBe('unresolved');
  await service.resolve('/shim/pwsh', runtimeAllowed); await service.refresh();
  expect(probe).toHaveBeenCalledTimes(2);
  expect(allUsers()?.path).toBe('/tool-2/Microsoft.PowerShell_profile.ps1');
});

it('does not launch an installation when passive discovery already supplied every path', async () => {
  const probe = vi.fn();
  const service = new PowerShellService(async()=>[{
    edition:'PowerShell 7', userDirectory:'/user/powershell',
    installations:[{id:'pwsh',executable:'/resolved/pwsh',home:'/resolved'}],
  }],probe,'linux');
  const refresh = await service.refresh(runtimeAllowed);
  await refresh.settled;
  expect(probe).not.toHaveBeenCalled();
});

it('caches failures across automatic refreshes and retries them only on explicit refresh', async () => {
  const probe = vi.fn(async()=>{throw new Error('blocked');});
  const service = new PowerShellService(async()=>[{
    edition:'PowerShell 7',installations:[{id:'pwsh',executable:'/test/pwsh'}],
  }],probe,'linux');
  await (await service.refresh(runtimeAllowed)).settled;
  await (await service.refresh(runtimeAllowed)).settled;
  expect(probe).toHaveBeenCalledTimes(1);
  await (await service.refresh(runtimeAllowed, true)).settled;
  expect(probe).toHaveBeenCalledTimes(2);
});

it('tries another installation before falling back and fails closed on disagreement', async () => {
  const probe = vi.fn(async (installation:{id:string}) => {
    if (installation.id === 'first') throw new Error('blocked');
    return installation.id === 'second'
      ? {home:'/second',userDirectory:'/user/powershell'}
      : {home:'/third',userDirectory:'/other/powershell'};
  });
  const service = new PowerShellService(async()=>[{
    edition:'PowerShell 7',installations:[
      {id:'first',executable:'/first/pwsh',home:'/first'},
      {id:'second',executable:'/second/pwsh',home:'/second'},
      {id:'third',executable:'/third/pwsh'},
    ],
  }],probe,'linux');
  const settled = await (await service.refresh(runtimeAllowed)).settled;
  expect(probe.mock.calls.map(call=>call[0].id)).toEqual(['first','second','third']);
  expect(settled?.editions[0]?.userDirectory).toBeUndefined();
  expect(settled?.editions[0]?.reason).toContain('disagree');
});

it('shares one registry fallback across editions and refreshes it only on explicit retry', async () => {
  const readDocuments = vi.fn(async()=> 'D:\\Redirected Documents');
  const discover = async ():Promise<EditionInfo[]> => [
    {edition:'PowerShell 7',installations:[{id:'pwsh',executable:'C:\\pwsh.exe',home:'C:\\PowerShell\\7'}]},
    {edition:'Windows PowerShell',installations:[{id:'windows',executable:'C:\\powershell.exe',home:'C:\\WindowsPowerShell'}]},
  ];
  const service = new PowerShellService(discover,vi.fn(async()=>{throw new Error('blocked');}),'win32',undefined,readDocuments);
  let settled = await (await service.refresh(runtimeAllowed)).settled;
  expect(readDocuments).toHaveBeenCalledTimes(1);
  expect(settled?.editions.map(edition=>edition.userDirectory)).toEqual([
    'D:\\Redirected Documents\\PowerShell','D:\\Redirected Documents\\WindowsPowerShell',
  ]);
  await (await service.refresh(runtimeAllowed)).settled;
  expect(readDocuments).toHaveBeenCalledTimes(1);
  settled = await (await service.refresh(runtimeAllowed,true)).settled;
  expect(readDocuments).toHaveBeenCalledTimes(2);
  expect(settled).toBeDefined();
});

it('limits probes for unresolved installation homes to two at a time', async () => {
  let active = 0;
  let maximum = 0;
  const releases: Array<()=>void> = [];
  const probe = vi.fn(async (installation:{id:string;home?:string}) => {
    active++;
    maximum = Math.max(maximum,active);
    if (installation.id !== 'known') await new Promise<void>(resolve=>releases.push(resolve));
    active--;
    return {home:installation.home ?? `/${installation.id}`,userDirectory:'/user/powershell'};
  });
  const service = new PowerShellService(async()=>[{
    edition:'PowerShell 7',installations:[
      {id:'known',executable:'/known/pwsh',home:'/known'},
      ...['one','two','three','four'].map(id=>({id,executable:`/${id}/pwsh`})),
    ],
  }],probe,'linux');
  const settling = (await service.refresh(runtimeAllowed)).settled;
  await vi.waitFor(()=>expect(releases).toHaveLength(2));
  expect(maximum).toBe(2);
  releases.splice(0).forEach(release=>release());
  await vi.waitFor(()=>expect(releases).toHaveLength(2));
  releases.splice(0).forEach(release=>release());
  await settling;
  expect(maximum).toBe(2);
});

it('does not publish a stale settlement while retaining its probe result for the current refresh', async () => {
  let finish!:()=>void;
  const probe = vi.fn(()=>new Promise<{home:string;userDirectory:string}>(resolve=>{
    finish=()=>resolve({home:'/resolved',userDirectory:'/user/powershell'});
  }));
  const service = new PowerShellService(async()=>[{
    edition:'PowerShell 7',installations:[{id:'pwsh',executable:'/test/pwsh'}],
  }],probe,'linux',async()=>true);
  const older = await service.refresh(runtimeAllowed);
  const current = await service.refresh(runtimeAllowed);
  finish();
  expect(await older.settled).toBeUndefined();
  expect((await current.settled)?.editions[0]?.userDirectory).toBe('/user/powershell');
  expect(probe).toHaveBeenCalledTimes(1);
});
