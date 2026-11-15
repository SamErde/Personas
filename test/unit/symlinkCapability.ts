import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Skip only a missing OS capability; unexpected setup failures must still fail tests. */
export function probeSymlinks(create: typeof fs.symlinkSync = fs.symlinkSync): boolean {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personas-symlink-probe-'));
  try {
    create(path.join(root,'absent'),path.join(root,'file-link'),'file');
    create(root,path.join(root,'directory-link'),'dir');
    return true;
  } catch (error) {
    if (['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
}
export const symlinksAvailable = probeSymlinks();
