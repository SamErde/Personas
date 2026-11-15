import { expect, it, vi } from 'vitest';
import { PowerShellService } from '../../src/powershell/service';
import type { EditionInfo } from '../../src/powershell/profiles';

it('launches only on explicit resolution and caches successful results across refreshes', async () => {
  const discover = async (): Promise<EditionInfo[]> => [{
    edition:'PowerShell 7', installations:[{id:'pwsh',executable:'/test/pwsh'}],
  }];
  const probe = vi.fn(async () => ({home:'/resolved',userDirectory:'/user/powershell'}));
  const service = new PowerShellService(discover,probe,'linux',async()=>true);
  await service.refresh(); await service.refresh();
  expect(probe).not.toHaveBeenCalled();
  await service.resolve('pwsh'); await service.refresh(); await service.refresh();
  expect(probe).toHaveBeenCalledTimes(1);
  expect(service.snapshot.rows.find(r=>r.host==='Console' && r.scope==='Current User')?.path).toBe('/user/powershell/Microsoft.PowerShell_profile.ps1');
  expect(service.snapshot.rows.find(r=>r.host==='Console' && r.scope==='All Users')?.path).toBe('/resolved/Microsoft.PowerShell_profile.ps1');
});
it('keeps unresolved paths after a failed probe and rejects unknown installation IDs', async () => {
  const probe=vi.fn(async()=>{throw new Error('timeout');});
  const service=new PowerShellService(async()=>[{edition:'PowerShell 7',installations:[{id:'pwsh',executable:'/test/pwsh'}]}],probe,'linux');
  await service.refresh();
  await expect(service.resolve('forged')).rejects.toThrow('no longer available');
  expect(probe).not.toHaveBeenCalled();
  await expect(service.resolve('pwsh')).rejects.toThrow('timeout');
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
  await service.refresh(); await service.resolve('/package-1');
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
  await service.refresh(); await service.resolve('/shim/pwsh'); await service.refresh();
  expect(allUsers()?.path).toBe('/tool-1/Microsoft.PowerShell_profile.ps1');
  homes[0]='/removed'; await service.refresh();
  expect(allUsers()?.state).toBe('unresolved');
  await service.resolve('/shim/pwsh'); await service.refresh();
  expect(probe).toHaveBeenCalledTimes(2);
  expect(allUsers()?.path).toBe('/tool-2/Microsoft.PowerShell_profile.ps1');
});
