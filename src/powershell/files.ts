import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProfileLocation, ProfileRow } from './profiles';

export async function inspectProfile(location: ProfileLocation): Promise<ProfileRow> {
  if (!location.path) return { ...location, state: 'unresolved', detail: location.reason ?? 'Profile directory unresolved' };
  try {
    const stat = await fs.lstat(location.path);
    if (stat.isSymbolicLink()) {
      const target = path.resolve(path.dirname(location.path), await fs.readlink(location.path));
      try {
        const targetStat = await fs.stat(location.path);
        if (targetStat.isFile()) await fs.access(location.path, fs.constants.R_OK);
        return { ...location, target, state: targetStat.isFile() ? 'existing' : 'inaccessible',
          detail: targetStat.isFile() ? undefined : 'Link target is not a file' };
      } catch (error) {
        return { ...location, target, state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'brokenLink' : 'inaccessible',
          detail: String(error) };
      }
    }
    if (!stat.isFile()) return { ...location, state: 'inaccessible', detail: 'Expected a profile file, found another file type' };
    await fs.access(location.path, fs.constants.R_OK);
    return { ...location, state: 'existing' };
  } catch (error) {
    return { ...location, state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'inaccessible',
      detail: (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : String(error) };
  }
}

export async function createProfile(location: ProfileLocation): Promise<ProfileRow> {
  const before = await inspectProfile(location);
  if (before.state === 'existing') return before;
  if (before.state !== 'missing' || !before.path || before.readOnly) throw new Error(before.detail ?? 'Profile cannot be created at this location');
  await fs.mkdir(path.dirname(before.path), { recursive: true });
  try { await (await fs.open(before.path, 'wx')).close(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const after = await inspectProfile(location);
  if (after.state !== 'existing') throw new Error('The destination changed; refresh before trying again');
  return after;
}

export interface DeleteProfileOptions {
  confirm(row: ProfileRow): Promise<boolean>;
  isDirty(file: string): Promise<boolean>;
  trash(file: string): Promise<void>;
  canTrashLinks: boolean;
}
async function fingerprint(file: string): Promise<string> {
  const s = await fs.lstat(file);
  return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.isSymbolicLink() ? await fs.readlink(file) : ''].join(':');
}
export async function deleteProfile(location: ProfileLocation, options: DeleteProfileOptions): Promise<void> {
  const row = await inspectProfile(location);
  if (!row.path || row.readOnly || !['existing', 'brokenLink'].includes(row.state)) throw new Error('Profile cannot be deleted');
  if (row.target && !options.canTrashLinks) throw new Error('Recoverable link-only deletion is unavailable. Reveal this link in the file manager instead.');
  const dirty = () => options.isDirty(row.path!);
  if (await dirty() || row.target && await options.isDirty(row.target)) throw new Error('Save or revert unsaved edits before deleting this profile');
  const before = await fingerprint(row.path);
  if (!await options.confirm(row)) return;
  if (await dirty() || row.target && await options.isDirty(row.target)) throw new Error('Profile has unsaved edits');
  if (before !== await fingerprint(row.path)) throw new Error('Profile changed during confirmation; refresh and try again');
  // The adapter must use Trash and must propagate failure, never permanently delete.
  await options.trash(row.path);
}
