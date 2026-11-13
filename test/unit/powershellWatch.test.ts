import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { affectsProfile, profileDependencies, profileWatchPlan } from '../../src/powershell/watch';
import { symlinksAvailable } from './symlinkCapability';
vi.mock('node:fs/promises', {spy:true});
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0)) await fs.rm(root,{recursive:true,force:true});});
async function root() {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'personas-chain-'));roots.push(temp);
  return fs.realpath(temp);
}
it.skipIf(!symlinksAvailable)('terminates cyclic chains while retaining both link dependencies',async()=>{
  const base=await root(), first=path.join(base,'first'), second=path.join(base,'second');
  await fs.symlink('second',first);await fs.symlink('first',second);
  const dependencies=await profileDependencies(first);
  expect(dependencies).toEqual(expect.arrayContaining([first,second]));
  expect(dependencies.length).toBeLessThan(5);
});
it.skipIf(!symlinksAvailable)('resolves dot-dot after directory links without dropping the intermediate link',async()=>{
  const base=await root();
  await fs.mkdir(path.join(base,'actual','nested'),{recursive:true});
  await fs.symlink(path.join(base,'actual','nested'),path.join(base,'alias'),'dir');
  const file=path.join(base,'profile.ps1');
  await fs.symlink('alias/../startup.ps1',file);
  const dependencies=await profileDependencies(file);
  expect(dependencies).toContain(path.join(base,'alias'));
  expect(dependencies).toContain(path.join(base,'actual','startup.ps1'));
  expect(dependencies).not.toContain(path.join(base,'startup.ps1'));
});

it.skipIf(!symlinksAvailable)('retains a missing component before dot-dot so its creation can refresh the row',async()=>{
  const base=await root(), file=path.join(base,'profile.ps1');
  await fs.writeFile(path.join(base,'target.ps1'),'target');
  await fs.symlink('missing/../target.ps1',file);
  const dependencies=await profileDependencies(file);
  expect(dependencies).toContain(path.join(base,'missing'));
  expect(affectsProfile(path.join(base,'missing'),dependencies)).toBe(true);
  await fs.mkdir(path.join(base,'missing'));
  const afterCreation=await profileDependencies(file);
  await fs.rmdir(path.join(base,'missing'));
  expect(affectsProfile(path.join(base,'missing'),afterCreation)).toBe(true);
});

it('filters events using the canonical parent spelling returned by the filesystem',async()=>{
  const base=await root();
  const {realpath}=await vi.importActual<typeof fs>('node:fs/promises');
  const canonical=base+'-canonical';
  vi.spyOn(fs,'realpath').mockImplementation(async directory=>
    String(directory)===base ? canonical : realpath(directory));
  const plan=await profileWatchPlan([path.join(base,'profile.ps1')]);
  expect(plan.directories).toContain(canonical);
  expect(affectsProfile(path.join(canonical,'profile.ps1'),plan.paths)).toBe(true);
});
