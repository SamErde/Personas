import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createProfile, inspectProfile, deleteProfile } from '../../src/powershell/files';
import type { ProfileLocation } from '../../src/powershell/profiles';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, {recursive:true, force:true}); });
it('creates an empty profile without overwriting a file that already exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-profile-')); roots.push(root);
  const location: ProfileLocation = {id:'test', edition:'PowerShell 7', scope:'Current User', host:'Console', path:path.join(root,'nested','profile.ps1'), readOnly:false};
  expect((await inspectProfile(location)).state).toBe('missing');
  await createProfile(location);
  expect(await fs.readFile(location.path!, 'utf8')).toBe('');
  await fs.writeFile(location.path!, 'keep me');
  await createProfile(location);
  expect(await fs.readFile(location.path!, 'utf8')).toBe('keep me');
});

it('blocks deletion of unsaved files and never calls trash', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-profile-')); roots.push(root);
  const location: ProfileLocation = {id:'delete', edition:'PowerShell 7', scope:'Current User', host:'Console', path:path.join(root,'profile.ps1'), readOnly:false};
  await fs.writeFile(location.path!, 'keep me');
  let trashed = false;
  await expect(deleteProfile(location, {
    confirm: async () => true, isDirty: async () => true,
    trash: async () => { trashed = true; }, canTrashLinks: false,
  })).rejects.toThrow('unsaved');
  expect(trashed).toBe(false);
  expect(await fs.readFile(location.path!, 'utf8')).toBe('keep me');
});

it('recognizes broken links and refuses to create over them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-profile-')); roots.push(root);
  const file = path.join(root, 'profile.ps1');
  await fs.symlink(path.join(root, 'absent.ps1'), file);
  const location: ProfileLocation = {id:'link',edition:'PowerShell 7',scope:'Current User',host:'Console',path:file,readOnly:false};
  expect((await inspectProfile(location)).state).toBe('brokenLink');
  await expect(createProfile(location)).rejects.toThrow();
  expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
});
it('rechecks a file changed during deletion confirmation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-profile-')); roots.push(root);
  const file = path.join(root, 'profile.ps1'); await fs.writeFile(file, 'old');
  const location: ProfileLocation = {id:'race',edition:'PowerShell 7',scope:'Current User',host:'Console',path:file,readOnly:false};
  let trashed = false;
  await expect(deleteProfile(location, {
    confirm: async () => {await fs.writeFile(file, 'changed contents'); return true;},
    isDirty: async () => false, trash: async () => {trashed=true;}, canTrashLinks:false,
  })).rejects.toThrow('changed');
  expect(trashed).toBe(false);
});
it('preserves files when Trash fails and respects cancellation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-profile-')); roots.push(root);
  const file = path.join(root, 'profile.ps1'); await fs.writeFile(file, '');
  const location: ProfileLocation = {id:'trash',edition:'PowerShell 7',scope:'All Users',host:'Console',path:file,readOnly:false};
  let calls=0;
  const options = {confirm:async()=>false,isDirty:async()=>false,trash:async()=>{calls++;throw new Error('Trash unavailable');},canTrashLinks:false};
  await deleteProfile(location, options); expect(calls).toBe(0);
  await expect(deleteProfile(location, {...options,confirm:async()=>true})).rejects.toThrow('Trash unavailable');
  expect(await fs.readFile(file,'utf8')).toBe('');
});
it('deletes only a link when a recoverable link-aware adapter is available', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-profile-')); roots.push(root);
  const target=path.join(root,'target.ps1'), file=path.join(root,'profile.ps1');
  await fs.writeFile(target,'keep target'); await fs.symlink(target,file);
  const location: ProfileLocation = {id:'link',edition:'PowerShell 7',scope:'Current User',host:'Console',path:file,readOnly:false};
  await deleteProfile(location, {confirm:async()=>true,isDirty:async()=>false,
    trash:async source=>fs.rename(source,path.join(root,'trash-link')),canTrashLinks:true});
  expect(await fs.readFile(target,'utf8')).toBe('keep target');
  expect((await fs.lstat(path.join(root,'trash-link'))).isSymbolicLink()).toBe(true);
});

it.skipIf(process.platform === 'win32')('reports an unreadable linked target without losing the link destination', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-profile-')); roots.push(root);
  const target=path.join(root,'private.ps1'), file=path.join(root,'profile.ps1');
  await fs.writeFile(target,'private'); await fs.symlink(target,file);
  const location: ProfileLocation = {id:'private',edition:'PowerShell 7',scope:'Current User',host:'Console',path:file,readOnly:false};
  await fs.chmod(target,0);
  try {
    const row=await inspectProfile(location);
    expect(row.state).toBe('inaccessible');
    expect(row.target).toBe(target);
  } finally {await fs.chmod(target,0o600);}
});
