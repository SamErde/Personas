import { expect, it, vi } from 'vitest';
import { PowerShellService } from '../../src/powershell/service';
import type { EditionInfo } from '../../src/powershell/profiles';

const runtimeAllowed = { allowRuntimeDiscovery:true, includeWindowsPowerShell:true };

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
