import { expect, it, vi } from 'vitest';
import { PowerShellService } from '../../src/powershell/service';
import type { EditionInfo, Installation } from '../../src/powershell/profiles';

const runtimeAllowed = { allowRuntimeDiscovery:true, includeWindowsPowerShell:true };

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value:T) => void;
  reject!: (reason?:unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve,reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

function serviceFor(
  editions: EditionInfo[],
  probe = vi.fn(),
  platform: NodeJS.Platform = 'linux',
  isPowerShellHome?: (home:string) => Promise<boolean>,
  readDocuments?: () => Promise<string|undefined>,
): PowerShellService {
  return new PowerShellService(
    vi.fn().mockResolvedValue(editions), probe, platform, isPowerShellHome, readDocuments,
  );
}

function row(service:PowerShellService, host:string, scope:string) {
  return service.snapshot.rows.find(item => item.host === host && item.scope === scope);
}

function installation(id:string, executable=`/${id}/pwsh`, home?:string): Installation {
  return {id,executable,...home ? {home} : {}};
}

function pwsh(installations:Installation[], details:Partial<EditionInfo> = {}): EditionInfo {
  return {edition:'PowerShell 7',installations,...details};
}

function probeLimiter(service:PowerShellService) {
  return service as unknown as {
    activeProbes:number;
    acquireProbeSlot():Promise<void>;
    releaseProbeSlot():void;
  };
}

async function expectQueuedCandidateCancelled(
  editions:EditionInfo[], gate:'runtime'|'windows', platform:NodeJS.Platform = 'linux',
) {
  const blocked = new Deferred<{home:string;userDirectory:string}>();
  const probe = vi.fn()
    .mockReturnValueOnce(blocked.promise)
    .mockResolvedValue({home:'/unused',userDirectory:'/unused'});
  const service = serviceFor(editions,probe,platform);
  const settling = (await service.refresh(runtimeAllowed)).settled;
  await vi.waitFor(()=>expect(probe).toHaveBeenCalledTimes(1));
  if (gate === 'runtime') service.setRuntimeDiscoveryAllowed(false);
  else service.setWindowsPowerShellIncluded(false);
  blocked.reject(new Error('blocked'));
  await settling;
  expect(probe).toHaveBeenCalledTimes(1);
}

it('publishes passive inventory before settlement and requires explicit runtime permission', async () => {
  {
    const result = new Deferred<{home:string;userDirectory:string}>();
    const probe = vi.fn().mockReturnValue(result.promise);
    const home = 'C:\\Program Files\\PowerShell\\7';
    const service = serviceFor([pwsh([installation('pwsh',`${home}\\pwsh.exe`,home)])],probe,'win32');
    const refresh = await service.refresh(runtimeAllowed);
    expect(probe).not.toHaveBeenCalled();
    expect(refresh.initial.rows[0]?.state).toBe('unresolved');
    await vi.waitFor(()=>expect(probe).toHaveBeenCalledTimes(1));
    result.resolve({home:'C:\\Program Files\\PowerShell\\7',userDirectory:'D:\\Documents\\PowerShell'});
    const settled = await refresh.settled;
    expect(settled?.rows[0]?.path).toBe('D:\\Documents\\PowerShell\\profile.ps1');
  }
  {
    const editions = [pwsh([installation('pwsh','/test/pwsh')])];
    const probe = vi.fn().mockResolvedValue({home:'/resolved', userDirectory:'/user/powershell'});
    const service = serviceFor(editions, probe, 'linux', vi.fn().mockResolvedValue(true));
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
    expect(row(service,'Console','Current User')?.path).toBe('/user/powershell/Microsoft.PowerShell_profile.ps1');
    expect(row(service,'Console','All Users')?.path).toBe('/resolved/Microsoft.PowerShell_profile.ps1');
  }
});
it('keeps failed probes unresolved and prefers newly discovered installation homes', async () => {
  {
    const probe=vi.fn().mockRejectedValue(new Error('timeout'));
    const service=serviceFor([pwsh([installation('pwsh','/test/pwsh')])],probe);
    await service.refresh();
    await expect(service.resolve('forged', runtimeAllowed)).rejects.toThrow('no longer available');
    expect(probe).not.toHaveBeenCalled();
    await expect(service.resolve('pwsh', runtimeAllowed)).rejects.toThrow('timeout');
    await service.refresh();
    expect(service.snapshot.rows).toHaveLength(6);
    for (const profile of service.snapshot.rows) expect(profile.state).toBe('unresolved');
  }
  {
    // A Microsoft Store update replaces the package folder while the launcher alias stays the same.
    const discover = vi.fn()
      .mockResolvedValueOnce([pwsh([installation('/package-1','/alias/pwsh','/package-1')])])
      .mockResolvedValue([pwsh([installation('/package-2','/alias/pwsh','/package-2')])]);
    const probe = vi.fn().mockResolvedValue({home:'/package-1',userDirectory:'/user/powershell'});
    const service = new PowerShellService(discover,probe,'linux');
    await service.refresh(); await service.resolve('/package-1', runtimeAllowed);
    await service.refresh();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(row(service,'Console','All Users')?.path).toBe('/package-2/Microsoft.PowerShell_profile.ps1');
    expect(row(service,'Console','Current User')?.path).toBe('/user/powershell/Microsoft.PowerShell_profile.ps1');
  }
});
it('drops a cached probe result once its home no longer holds PowerShell and offers resolution again', async () => {
  // Updating a .NET global tool keeps the launcher shim while its versioned home is replaced.
  const validHomes=new Set(['/tool-1','/tool-2']);
  const retryResult=new Deferred<{home:string;userDirectory:string}>();
  const holdsPowerShell=vi.fn().mockImplementation(validHomes.has.bind(validHomes));
  const probe = vi.fn()
    .mockResolvedValueOnce({home:'/tool-1',userDirectory:'/user/powershell'})
    .mockReturnValueOnce(retryResult.promise)
    .mockResolvedValue({home:'/tool-2',userDirectory:'/user/powershell'});
  const service = serviceFor(
    [pwsh([installation('/shim/pwsh','/shim/pwsh')])],probe,'linux',
    holdsPowerShell,
  );
  await service.refresh(); await service.resolve('/shim/pwsh', runtimeAllowed); await service.refresh();
  expect(row(service,'Console','All Users')?.path).toBe('/tool-1/Microsoft.PowerShell_profile.ps1');
  const retry=service.resolve('/shim/pwsh',runtimeAllowed);
  await vi.waitFor(()=>expect(probe).toHaveBeenCalledTimes(2));
  validHomes.delete('/tool-1'); await service.refresh();
  expect(row(service,'Console','All Users')?.state).toBe('unresolved');
  retryResult.reject(new Error('blocked'));
  await expect(retry).rejects.toThrow('blocked');
  await (await service.refresh(runtimeAllowed)).settled;
  expect(probe).toHaveBeenCalledTimes(2);
  await service.resolve('/shim/pwsh', runtimeAllowed); await service.refresh();
  expect(probe).toHaveBeenCalledTimes(3);
  expect(row(service,'Console','All Users')?.path).toBe('/tool-2/Microsoft.PowerShell_profile.ps1');

  const validation=new Deferred<boolean>();
  holdsPowerShell.mockReturnValueOnce(validation.promise);
  validHomes.add('/tool-3');
  probe.mockResolvedValueOnce({home:'/tool-3',userDirectory:'/user/powershell'});
  const checking=service.refresh(runtimeAllowed);
  await vi.waitFor(()=>expect(holdsPowerShell).toHaveBeenCalledWith('/tool-2'));
  await service.resolve('/shim/pwsh',runtimeAllowed);
  validation.resolve(true);
  await checking;
  expect(row(service,'Console','All Users')?.path).toBe('/tool-3/Microsoft.PowerShell_profile.ps1');
  await service.refresh(runtimeAllowed);
  expect(probe).toHaveBeenCalledTimes(4);
  expect(row(service,'Console','All Users')?.path).toBe('/tool-3/Microsoft.PowerShell_profile.ps1');
});

it('enforces passive discovery, negative cache, and fallback boundaries', async () => {
  // Complete passive data must never start a runtime probe.
  {
    const probe = vi.fn();
    const service = serviceFor([
      pwsh([installation('pwsh','/resolved/pwsh','/resolved')],{userDirectory:'/user/powershell'}),
    ],probe);
    const refresh = await service.refresh(runtimeAllowed);
    await refresh.settled;
    expect(probe).not.toHaveBeenCalled();
  }

  // Automatic refreshes share negative cache entries; only Retry clears them.
  {
    const probe = vi.fn().mockRejectedValue(new Error('blocked'));
    const service = serviceFor([pwsh([installation('pwsh','/test/pwsh')])],probe);
    await (await service.refresh(runtimeAllowed)).settled;
    await (await service.refresh(runtimeAllowed)).settled;
    expect(probe).toHaveBeenCalledTimes(1);
    await (await service.refresh(runtimeAllowed, true)).settled;
    expect(probe).toHaveBeenCalledTimes(2);
  }

  // One lazy registry fallback is shared across editions and renewed by Retry.
  {
    const readDocuments = vi.fn().mockResolvedValue('D:\\Redirected Documents');
    const editions: EditionInfo[] = [
      pwsh([installation('pwsh','C:\\pwsh.exe','C:\\PowerShell\\7')]),
      {edition:'Windows PowerShell',installations:[installation('windows','C:\\powershell.exe','C:\\WindowsPowerShell')]},
    ];
    const service = serviceFor(editions,vi.fn().mockRejectedValue(new Error('blocked')),'win32',undefined,readDocuments);
    let settled = await (await service.refresh(runtimeAllowed)).settled;
    expect(readDocuments).toHaveBeenCalledTimes(1);
    expect(settled?.editions[0]?.userDirectory).toBe('D:\\Redirected Documents\\PowerShell');
    expect(settled?.editions[1]?.userDirectory).toBe('D:\\Redirected Documents\\WindowsPowerShell');
    const cached = await service.refresh(runtimeAllowed);
    expect(cached.initial.editions[0]?.userDirectory).toBe('D:\\Redirected Documents\\PowerShell');
    expect(cached.initial.editions[1]?.userDirectory).toBe('D:\\Redirected Documents\\WindowsPowerShell');
    await cached.settled;
    expect(readDocuments).toHaveBeenCalledTimes(1);
    settled = await (await service.refresh(runtimeAllowed,true)).settled;
    expect(readDocuments).toHaveBeenCalledTimes(2);
    expect(settled).toBeDefined();

    const oldDocuments = new Deferred<string|undefined>();
    const newDocuments = new Deferred<string|undefined>();
    const retryDiscovery = new Deferred<EditionInfo[]>();
    const retryEditions = [pwsh([installation('pwsh','C:\\pwsh.exe','C:\\PowerShell\\7')])];
    const discover = vi.fn().mockResolvedValueOnce(retryEditions).mockReturnValueOnce(retryDiscovery.promise);
    const retryRead = vi.fn()
      .mockReturnValueOnce(oldDocuments.promise)
      .mockReturnValueOnce(newDocuments.promise);
    const racing = new PowerShellService(
      discover,vi.fn().mockRejectedValue(new Error('blocked')),'win32',undefined,retryRead,
    );
    const oldRefresh = await racing.refresh(runtimeAllowed);
    await vi.waitFor(()=>expect(retryRead).toHaveBeenCalledTimes(1));
    const retrying = racing.refresh(runtimeAllowed,true);
    oldDocuments.resolve('D:\\Old Documents');
    await oldRefresh.settled;
    retryDiscovery.resolve(retryEditions);
    const retryRefresh = await retrying;
    expect(retryRefresh.initial.editions[0]?.userDirectory).toBeUndefined();
    await vi.waitFor(()=>expect(retryRead).toHaveBeenCalledTimes(2));
    newDocuments.resolve('D:\\New Documents');
    expect((await retryRefresh.settled)?.editions[0]?.userDirectory).toBe('D:\\New Documents\\PowerShell');
  }

  // A fallback for one installed edition must not fabricate another edition.
  {
    const service = serviceFor([
      pwsh([installation('pwsh','C:\\pwsh.exe','C:\\PowerShell\\7')]),
      {edition:'Windows PowerShell',installations:[],reason:'Installation not found'},
    ],vi.fn().mockResolvedValue({home:'C:\\PowerShell\\7',userDirectory:'D:\\Documents\\PowerShell'}),
    'win32',undefined,vi.fn().mockResolvedValue('D:\\Documents'));
    const settled = await (await service.refresh(runtimeAllowed)).settled;
    const windows = settled?.editions[1];
    expect(windows?.userDirectory).toBeUndefined();
    expect(windows?.reason).toBe('Installation not found');
    expect(settled?.rows).not.toContainEqual(expect.objectContaining({edition:'Windows PowerShell',path:expect.any(String)}));
  }
});

it('enforces concurrency, retry intent, and queued runtime gates', async () => {
  // Releasing a slot hands it directly to its waiter instead of a barger.
  {
    const service = probeLimiter(serviceFor([]));
    await service.acquireProbeSlot(); await service.acquireProbeSlot();
    const waiter = service.acquireProbeSlot();
    service.releaseProbeSlot();
    const barger = service.acquireProbeSlot();
    await waiter;
    expect(service.activeProbes).toBe(2);
    service.releaseProbeSlot();
    await barger;
    expect(service.activeProbes).toBe(2);
    service.releaseProbeSlot(); service.releaseProbeSlot();
  }

  // Queued probes must honor a runtime-discovery opt-out before they launch.
  {
    await expectQueuedCandidateCancelled([pwsh([
      installation('first','/first/pwsh','/first'),
      installation('second','/second/pwsh','/second'),
    ])],'runtime');
  }

  // Windows PowerShell exclusion must likewise cancel its queued candidates.
  {
    await expectQueuedCandidateCancelled([{
      edition:'Windows PowerShell',installations:[
        installation('first','C:\\first\\powershell.exe','C:\\first'),
        installation('second','C:\\second\\powershell.exe','C:\\second'),
      ],
    }],'windows','win32');
  }

  // A newer Retry keeps its fresh intent when it joins a stale queued Retry.
  {
    const probe = vi.fn()
      .mockResolvedValueOnce({home:'/old',userDirectory:'/old-user'})
      .mockResolvedValueOnce({home:'/new',userDirectory:'/new-user'});
    const service = serviceFor([
      pwsh([installation('pwsh','/test/pwsh','/old')]),
    ],probe,'linux',vi.fn().mockResolvedValue(true));
    await service.refresh();
    await service.resolve('pwsh',runtimeAllowed);
    await service.refresh(runtimeAllowed);
    const limiter = probeLimiter(service);
    await limiter.acquireProbeSlot(); await limiter.acquireProbeSlot();
    const older = service.resolve('pwsh',runtimeAllowed);
    const olderResult = expect(older).rejects.toThrow('superseded');
    await service.refresh(runtimeAllowed);
    const newer = service.resolve('pwsh',runtimeAllowed);
    limiter.releaseProbeSlot();
    await olderResult; await newer;
    expect(probe).toHaveBeenCalledTimes(2);
    limiter.releaseProbeSlot();
  }
});

it('tries another installation before falling back and fails closed on disagreement', async () => {
  const retryResult = new Deferred<{home:string;userDirectory:string}>();
  const probe = vi.fn()
    .mockRejectedValueOnce(new Error('blocked'))
    .mockResolvedValueOnce({home:'/second',userDirectory:'/user/powershell'})
    .mockResolvedValueOnce({home:'/third',userDirectory:'/other/powershell'})
    .mockReturnValueOnce(retryResult.promise)
    .mockResolvedValueOnce({home:'/second',userDirectory:'/other/powershell'});
  const service = serviceFor([pwsh([
    installation('first','/first/pwsh','/first'),
    installation('second','/second/pwsh','/second'),
    installation('third','/third/pwsh'),
  ])],probe,'linux',vi.fn().mockResolvedValue(true));
  const settled = await (await service.refresh(runtimeAllowed)).settled;
  expect(probe).toHaveBeenNthCalledWith(1,expect.objectContaining({id:'first'}),'PowerShell 7');
  expect(probe).toHaveBeenNthCalledWith(2,expect.objectContaining({id:'second'}),'PowerShell 7');
  expect(probe).toHaveBeenNthCalledWith(3,expect.objectContaining({id:'third'}),'PowerShell 7');
  expect(settled?.editions[0]?.userDirectory).toBeUndefined();
  expect(settled?.editions[0]?.reason).toContain('disagree');
  const retry = service.resolve('second',runtimeAllowed);
  await vi.waitFor(()=>expect(probe).toHaveBeenCalledTimes(4));
  const duringRetry = await service.refresh(runtimeAllowed);
  expect(duringRetry.initial.editions[0]?.userDirectory).toBeUndefined();
  expect(duringRetry.initial.editions[0]?.reason).toContain('disagree');
  retryResult.reject(new Error('retry failed'));
  await expect(retry).rejects.toThrow('retry failed');
  const afterFailure = await service.refresh(runtimeAllowed);
  expect(afterFailure.initial.editions[0]?.userDirectory).toBeUndefined();
  expect(afterFailure.initial.editions[0]?.reason).toContain('disagree');
  await service.resolve('second',runtimeAllowed);
  const afterSuccess = await service.refresh(runtimeAllowed);
  expect(afterSuccess.initial.editions[0]?.userDirectory).toBe('/other/powershell');
  expect(afterSuccess.initial.editions[0]?.reason).toBeUndefined();

  const conflicting = serviceFor([
    pwsh([installation('passive','/passive/pwsh','/passive')],{userDirectory:'/passive/user'}),
  ],vi.fn().mockResolvedValue({home:'/passive',userDirectory:'/cached/user'}));
  await conflicting.refresh(runtimeAllowed);
  await conflicting.resolve('passive',runtimeAllowed);
  const repeat = await conflicting.refresh(runtimeAllowed);
  expect(repeat.initial.editions[0]?.reason).toContain('disagree');
  expect(repeat.initial.editions[0]?.userDirectory).toBeUndefined();
  expect((await repeat.settled)?.editions[0]?.userDirectory).toBeUndefined();
});

it('joins current probes and retries skipped probes for overlapping refreshes', async () => {
  {
    const result = new Deferred<{home:string;userDirectory:string}>();
    const probe = vi.fn().mockReturnValue(result.promise);
    const service = serviceFor(
      [pwsh([installation('pwsh','/test/pwsh','/test')])],probe,'linux',vi.fn().mockResolvedValue(true),
    );
    const older = await service.refresh(runtimeAllowed);
    const current = await service.refresh(runtimeAllowed);
    const retry = service.resolve('pwsh',runtimeAllowed);
    await vi.waitFor(()=>expect(probe).toHaveBeenCalledTimes(1));
    result.resolve({home:'/resolved',userDirectory:'/user/powershell'});
    await retry;
    expect(await older.settled).toBeUndefined();
    expect((await current.settled)?.editions[0]?.userDirectory).toBe('/user/powershell');
    expect(probe).toHaveBeenCalledTimes(1);
  }
  {
    const first = new Deferred<{home:string;userDirectory:string}>();
    const second = new Deferred<{home:string;userDirectory:string}>();
    const probe = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue({home:'/third',userDirectory:'/user/powershell'});
    const service = serviceFor([
      pwsh([installation('first'),installation('second'),installation('third')],{userDirectory:'/user/powershell'}),
    ],probe);
    const older = await service.refresh(runtimeAllowed);
    await vi.waitFor(()=>expect(probe).toHaveBeenCalledTimes(2));
    const current = await service.refresh(runtimeAllowed);
    first.resolve({home:'/first',userDirectory:'/user/powershell'});
    second.resolve({home:'/second',userDirectory:'/user/powershell'});
    const settled = await current.settled;
    expect(await older.settled).toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(3);
    expect(settled?.editions[0]?.installations[2]?.home).toBe('/third');
  }
});
