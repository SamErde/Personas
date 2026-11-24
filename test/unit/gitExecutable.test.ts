import { expect, it } from 'vitest';
import { findGitExecutable, type ExecutableLookup } from '../../src/git/executable';

/** A lookup over a made-up disk, recording every path that was asked about. */
function disk(platform: ExecutableLookup['platform'], env: NodeJS.ProcessEnv, files: string[]) {
  const asked: string[] = [];
  const lookup: ExecutableLookup = {
    platform,
    env,
    isFile: async (file) => {
      asked.push(file);
      return files.includes(file);
    },
  };
  return { lookup, asked };
}

it('finds git in the absolute folders of PATH on Windows, never in the current folder', async () => {
  const { lookup, asked } = disk('win32', { Path: 'C:\\tools;.;;relative\\bin;C:\\Git\\cmd' }, ['C:\\Git\\cmd\\git.exe']);

  expect(await findGitExecutable([], lookup)).toBe('C:\\Git\\cmd\\git.exe');
  // Every candidate is an absolute path under a PATH folder: nothing is left for Windows to
  // look up beside the file being inspected.
  expect(asked.every((file) => file.startsWith('C:\\tools\\') || file.startsWith('C:\\Git\\cmd\\'))).toBe(true);
});

it('honours PATHEXT order within a folder', async () => {
  const { lookup } = disk('win32', { PATH: 'C:\\Git\\cmd', PATHEXT: '.EXE;.CMD' }, ['C:\\Git\\cmd\\git.cmd', 'C:\\Git\\cmd\\git.exe']);
  expect(await findGitExecutable([], lookup)).toBe('C:\\Git\\cmd\\git.exe');
});

it('takes the first entry of git.path that exists, then falls back to PATH', async () => {
  const files = ['D:\\Portable\\git.exe', 'C:\\Git\\cmd\\git.exe'];
  const env = { PATH: 'C:\\Git\\cmd' };

  const second = disk('win32', env, files);
  expect(await findGitExecutable(['C:\\Gone\\git.exe', 'D:\\Portable\\git.exe'], second.lookup)).toBe('D:\\Portable\\git.exe');

  const none = disk('win32', env, files);
  expect(await findGitExecutable(['C:\\Gone\\git.exe'], none.lookup)).toBe('C:\\Git\\cmd\\git.exe');
});

it('ignores a relative git.path entry, which would depend on the folder Git runs in', async () => {
  const { lookup, asked } = disk('linux', { PATH: '/usr/bin' }, ['/usr/bin/git']);
  expect(await findGitExecutable(['./bin/git'], lookup)).toBe('/usr/bin/git');
  expect(asked).toEqual(['/usr/bin/git']);
});

it('looks a bare name up on PATH on POSIX, and reports none when there is none', async () => {
  const found = disk('linux', { PATH: '/opt/bin:/usr/bin' }, ['/usr/bin/git']);
  expect(await findGitExecutable([], found.lookup)).toBe('/usr/bin/git');

  const missing = disk('linux', { PATH: '/opt/bin:/usr/bin' }, []);
  expect(await findGitExecutable([], missing.lookup)).toBeUndefined();
});
