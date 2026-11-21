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
  documents: [] as any[],
  errors: [] as string[],
  trashed: [] as string[],
  commands: [] as any[][],
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
    commands: {executeCommand: async (...args:any[]) => {mock.commands.push(args);}},
    window: {
      showErrorMessage: (message:string) => {mock.errors.push(message);},
      showWarningMessage: async () => 'Move to Trash',
    },
    workspace: {
      textDocuments: mock.documents,
      fs: {delete: async (file:any) => {mock.trashed.push(file.fsPath);}},
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
  mock.documents.length=0;mock.errors.length=0;mock.trashed.length=0;mock.commands.length=0;
  for(const root of roots.splice(0)) await fs.rm(root,{recursive:true,force:true});
});
async function setup(reconcileMs=0) {
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'personas-events-')); roots.push(temporary);
  const root=await fs.realpath(temporary);
  const discover=vi.fn(async()=>[{edition:'PowerShell 7' as const,userDirectory:root,installations:[]}]);
  const service=new PowerShellService(discover,undefined,'linux');
  const controller=new PowerShellController(()=>{},service,undefined,{reconcileMs});
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

it('reattaches watches when a profile directory is externally replaced at the same path',async()=>{
  const {root,controller,service,discover}=await setup();
  const file=path.join(root,'profile.ps1'), moved=root+'-moved';
  roots.push(moved);
  await fs.writeFile(file,'original',{flag:'wx'});
  controller.setActive(true);
  await controller.refresh();
  const original=mock.watchers.find(w=>!w.disposed && w.pattern.baseUri.fsPath===root);
  const parent=mock.watchers.find(w=>!w.disposed && w.pattern.baseUri.fsPath===path.dirname(root));
  expect(parent).toBeDefined();
  discover.mockClear();
  // Replacement completes before the debounced refresh; the set of watch paths is unchanged.
  await fs.rename(root,moved);
  await fs.mkdir(root);
  await fs.writeFile(file,'replacement',{flag:'wx'});
  parent.Delete(uri(root)); parent.Create(uri(root));
  await vi.waitFor(()=>expect(discover).toHaveBeenCalled(),{timeout:3000});
  await vi.waitFor(()=>expect(original.disposed).toBe(true));
  expect(parent.disposed).toBe(false);
  const replacement=mock.watchers.find(w=>!w.disposed && w.pattern.baseUri.fsPath===root);
  expect(replacement).toBeDefined();
  await fs.unlink(file); replacement.Delete(uri(file));
  await vi.waitFor(()=>expect(service.snapshot.rows.find(row=>row.host==='All Hosts')?.state).toBe('missing'),{timeout:3000});
});

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** An active controller with the reconciliation backstop on and, unless `settle` is false, a recorded baseline. */
async function reconciling(content?:string,{reconcileMs=40,settle=true}={}) {
  const context=await setup(reconcileMs);
  const file=path.join(context.root,'profile.ps1');
  if(content!==undefined) await fs.writeFile(file,content,{flag:'wx'});
  context.controller.setActive(true);
  await context.controller.refresh();
  if(settle) await sleep(100);
  context.discover.mockClear();
  const state=()=>context.service.snapshot.rows.find(row=>row.host==='All Hosts')?.state;
  return {...context,file,state};
}

it('reconciles directory replacement when every watcher event is dropped',async()=>{
  const {root,file,state}=await reconciling('original');
  const moved=root+'-moved'; roots.push(moved);
  const original=mock.watchers.find(w=>!w.disposed && w.pattern.baseUri.fsPath===root);
  expect(state()).toBe('existing');
  // No watcher callback is ever invoked below: only the reconciliation backstop can notice.
  await fs.rename(root,moved);
  await vi.waitFor(()=>expect(state()).toBe('missing'),{timeout:3000});
  await vi.waitFor(()=>expect(original.disposed).toBe(true)); // Re-planned after the state was published.
  await fs.mkdir(root);
  await fs.writeFile(file,'replacement',{flag:'wx'});
  await vi.waitFor(()=>expect(state()).toBe('existing'),{timeout:3000});
  await vi.waitFor(()=>expect(mock.watchers.some(w=>!w.disposed && w.pattern.baseUri.fsPath===root)).toBe(true),{timeout:3000});
});

it('catches a change dropped before the first tick by checking the shown inventory',async()=>{
  const {file,state}=await reconciling('original',{reconcileMs:200,settle:false});
  expect(state()).toBe('existing');
  await fs.unlink(file); // Before any baseline exists, and no watcher callback fires.
  await vi.waitFor(()=>expect(state()).toBe('missing'),{timeout:3000});
});

it.skipIf(!symlinksAvailable)('catches a link target removed before the first tick',async()=>{
  const context=await setup(200);
  const target=path.join(context.root,'target.ps1');
  await fs.writeFile(target,'original',{flag:'wx'});
  await fs.symlink(target,path.join(context.root,'profile.ps1'));
  context.controller.setActive(true);
  await context.controller.refresh();
  const state=()=>context.service.snapshot.rows.find(row=>row.host==='All Hosts')?.state;
  expect(state()).toBe('existing');
  await fs.unlink(target); // The link itself is untouched, so its own identity does not change.
  await vi.waitFor(()=>expect(state()).toBe('brokenLink'),{timeout:3000});
});

it('reconciles only while active, with one timer however often Home reports visibility',async()=>{
  const intervals=vi.spyOn(globalThis,'setInterval');
  const {file,controller,discover}=await reconciling();
  controller.setActive(true);
  expect(intervals).toHaveBeenCalledTimes(1);
  controller.setActive(false);
  await fs.writeFile(file,'created while hidden',{flag:'wx'});
  await sleep(500);
  expect(discover).not.toHaveBeenCalled();
  controller.dispose();
  controller.setActive(true);
  expect(intervals).toHaveBeenCalledTimes(1); // A disposed controller never starts polling again.
  await sleep(500);
  expect(discover).not.toHaveBeenCalled();
});

it('ignores content-only edits that keep the same file identity',async()=>{
  const {file,discover}=await reconciling('original');
  await fs.appendFile(file,'# edited in place');
  await sleep(500);
  expect(discover).not.toHaveBeenCalled();
});


it('blocks deletion while a hard-linked alias of the profile has unsaved edits',async()=>{
  const {root,controller,service}=await setup();
  const file=path.join(root,'profile.ps1'), alias=path.join(root,'dotfiles.ps1'), unrelated=path.join(root,'unrelated.ps1');
  await fs.writeFile(file,'content',{flag:'wx'}); await fs.link(file,alias);
  await fs.writeFile(unrelated,'other',{flag:'wx'});
  await controller.refresh();
  const id=service.snapshot.rows.find(row=>row.host==='All Hosts')!.id;
  mock.documents.push({isDirty:true,uri:uri(alias)});
  await controller.handle({type:'powerShellAction',action:'delete',id});
  expect(mock.errors.at(-1)).toContain('Save or revert unsaved edits');
  expect(mock.trashed).toEqual([]);
  // A dirty file with a different identity must not block the hard-linked profile.
  mock.documents.splice(0,1,{isDirty:true,uri:uri(unrelated)});
  await controller.handle({type:'powerShellAction',action:'delete',id});
  expect(mock.trashed).toHaveLength(1);
});

it('reveals the nearest existing folder when a missing profile has no folder yet',async()=>{
  const {root}=await setup();
  const service=new PowerShellService(async()=>[{edition:'PowerShell 7' as const,userDirectory:path.join(root,'absent','powershell'),installations:[]}],undefined,'linux');
  const controller=new PowerShellController(()=>{},service,undefined,{reconcileMs:0});
  controllers.push(controller);
  await controller.refresh();
  const row=service.snapshot.rows.find(row=>row.host==='All Hosts')!;
  expect(row.state).toBe('missing');
  await controller.handle({type:'powerShellAction',action:'reveal',id:row.id});
  expect(mock.commands).toEqual([['revealFileInOS',uri(root)]]);
  expect(mock.errors).toEqual([]);
  expect(await fs.readdir(root)).toEqual([]);
});
