import { expect, it } from 'vitest';
import { probeSymlinks } from './symlinkCapability';
it('treats missing symlink privilege as an unavailable capability',()=>{
  expect(probeSymlinks(()=>{throw Object.assign(new Error('privilege unavailable'),{code:'EPERM'});})).toBe(false);
});
it('does not hide unexpected symlink fixture failures',()=>{
  expect(()=>probeSymlinks(()=>{throw Object.assign(new Error('disk failure'),{code:'EIO'});})).toThrow('disk failure');
});
