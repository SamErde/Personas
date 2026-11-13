import { expect, it, vi } from 'vitest';
import { PowerShellService } from '../../src/powershell/service';
import type { EditionInfo } from '../../src/powershell/profiles';

it('launches only on explicit resolution and caches successful results across refreshes', async () => {
  const discover = async (): Promise<EditionInfo[]> => [{
    edition:'PowerShell 7', installations:[{id:'pwsh',executable:'/test/pwsh'}],
  }];
  const probe = vi.fn(async () => ({home:'/resolved',userDirectory:'/user/powershell'}));
  const service = new PowerShellService(discover,probe,'linux');
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
