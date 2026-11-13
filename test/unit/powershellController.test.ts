import { symlinksAvailable } from './symlinkCapability';
import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PowerShellController } from '../../src/panel/powerShellController';
import { PowerShellService } from '../../src/powershell/service';

const mock = vi.hoisted(() => ({
  events: new Map<string, (event: any) => void>(),
  watchers: [] as any[],
}));
vi.mock('vscode', () => {
  const register = (name:string) => (callback:(event:any)=>void) => {
    mock.events.set(name, callback);
    return {dispose:()=>mock.events.delete(name)};
  };
  return {
    env: {},
    Uri: {file:(fsPath:string)=>({scheme:'file',fsPath})},
    RelativePattern: class { constructor(public baseUri:any, public pattern:string) {} },
    workspace: {
      onDidSaveTextDocument: register('save'), onDidCreateFiles: register('create'),
      onDidDeleteFiles: register('delete'), onDidRenameFiles: register('rename'),
      createFileSystemWatcher: (pattern:any) => {
        const watcher:any={pattern,disposed:false,dispose(){this.disposed=true;}};
        for(const name of ['Create','Change','Delete']) watcher['onDid'+name]=(callback:any)=>{watcher[name]=callback;};
        mock.watchers.push(watcher);
        return watcher;
      },
    },
  };
});
const roots:string[]=[];
const controllers:PowerShellController[]=[];
afterEach(async()=>{
  controllers.splice(0).forEach(controller=>controller.dispose());
  mock.events.clear();mock.watchers.length=0;vi.useRealTimers();
  for(const root of roots.splice(0)) await fs.rm(root,{recursive:true,force:true});
});
async function setup() {
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'personas-events-')); roots.push(temporary);
  const root=await fs.realpath(temporary);
  const discover=vi.fn(async()=>[{edition:'PowerShell 7' as const,userDirectory:root,installations:[]}]);
  const service=new PowerShellService(discover,undefined,'linux');
  const controller=new PowerShellController(()=>{},service);
  controllers.push(controller);
  return {root,discover,service,controller};
}
const uri=(fsPath:string)=>({scheme:'file',fsPath});
it('ignores inactive and unrelated events, but refreshes for profile and ancestor changes',async()=>{
  const {root,discover,controller}=await setup();
  vi.useFakeTimers();
  mock.events.get('save')!({uri:uri(path.join(root,'unrelated.txt'))});
  await vi.advanceTimersByTimeAsync(350);
  expect(discover).not.toHaveBeenCalled();
  controller.setActive(true);
  await controller.refresh();
  discover.mockClear();
  mock.events.get('save')!({uri:uri(path.join(root,'unrelated.txt'))});
  for(const name of ['create','delete']) mock.events.get(name)!({files:[uri(path.join(root,'other'))]});
  mock.events.get('rename')!({files:[{oldUri:uri(path.join(root,'a')),newUri:uri(path.join(root,'b'))}]});
  await vi.advanceTimersByTimeAsync(350);
  expect(discover).not.toHaveBeenCalled();
  mock.events.get('save')!({uri:uri(path.join(root,'profile.ps1'))});
  await vi.advanceTimersByTimeAsync(350);
  expect(discover).toHaveBeenCalledTimes(1);
  await controller.refresh();
  discover.mockClear();
  mock.events.get('rename')!({files:[{oldUri:uri(root),newUri:uri(root+'-moved')}]});
  await vi.advanceTimersByTimeAsync(350);
  expect(discover).toHaveBeenCalledTimes(1);
  controller.setActive(false);
  await controller.refresh(); // Explicit refresh still works, but must not install background watches.
  discover.mockClear();
  mock.events.get('save')!({uri:uri(path.join(root,'profile.ps1'))});
  await vi.advanceTimersByTimeAsync(350);
  expect(discover).not.toHaveBeenCalled();
  expect(mock.watchers.every(watcher=>watcher.disposed)).toBe(true);
});
it.skipIf(!symlinksAvailable)('watches intermediate and final link destinations, including a missing destination parent',async()=>{
  const {root,controller,service}=await setup();
  for(const directory of ['links','scripts']) await fs.mkdir(path.join(root,directory));
  await fs.symlink('links/startup.ps1',path.join(root,'profile.ps1'));
  await fs.symlink('../scripts/nested/startup.ps1',path.join(root,'links','startup.ps1'));
  controller.setActive(true);
  await controller.refresh();
  const bases=mock.watchers.filter(w=>!w.disposed).map(w=>w.pattern.baseUri.fsPath);
  expect(bases).toContain(path.join(root,'links'));
  expect(bases).toContain(path.join(root,'scripts'));
  const state=()=>service.snapshot.rows.find(row=>row.host==='All Hosts')?.state;
  const emit=(directory:string,kind:string,file:string)=>{
    const watcher=mock.watchers.find(w=>!w.disposed && w.pattern.baseUri.fsPath===directory);
    expect(watcher).toBeDefined(); watcher[kind](uri(file));
  };
  const nested=path.join(root,'scripts','nested'), target=path.join(nested,'startup.ps1');
  expect(state()).toBe('brokenLink');
  await fs.mkdir(nested);await fs.writeFile(target,'content',{flag:'wx'});
  emit(path.join(root,'scripts'),'Create',nested);
  await vi.waitFor(()=>expect(state()).toBe('existing'),{timeout:3000});
  await vi.waitFor(()=>expect(mock.watchers.some(w=>!w.disposed && w.pattern.baseUri.fsPath===nested)).toBe(true));
  await fs.unlink(target); emit(nested,'Delete',target);
  await vi.waitFor(()=>expect(state()).toBe('brokenLink'),{timeout:3000});
  await fs.writeFile(target,'replacement',{flag:'wx'}); emit(nested,'Create',target);
  await vi.waitFor(()=>expect(state()).toBe('existing'),{timeout:3000});
  const middle=path.join(root,'links','startup.ps1');
  await fs.unlink(middle); await fs.symlink('../missing/startup.ps1',middle);
  emit(path.join(root,'links'),'Change',middle);
  await vi.waitFor(()=>expect(state()).toBe('brokenLink'),{timeout:3000});
});

it('drops queued automatic refreshes after Home is hidden',async()=>{
  const {root,discover,controller}=await setup();
  let finish!:()=>void;
  discover.mockImplementationOnce(()=>new Promise(resolve=>{
    finish=()=>resolve([{edition:'PowerShell 7',userDirectory:root,installations:[]}]);
  }));
  controller.setActive(true);
  const first=controller.refresh(true);
  await Promise.resolve();
  const queued=controller.refresh(true);
  controller.setActive(false);
  finish();
  await Promise.all([first,queued]);
  expect(discover).toHaveBeenCalledTimes(1);
  expect(mock.watchers).toHaveLength(0);
});
