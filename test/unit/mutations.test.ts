import { describe, expect, it } from 'vitest';
import { MutationError, MutationService } from '../../src/core/mutations';

const okRunner = () => {
  const calls: string[][] = [];
  const run = async (_cli: string, args: string[]) => {
    calls.push(args);
    return { code: 0, stdout: '', stderr: '' };
  };
  return { calls, run };
};

const svc = (run: (cli: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>) =>
  new MutationService({ cliPath: '/bin/code', extraArgs: ['--user-data-dir', '/ud', '--extensions-dir', '/ed'], run });

describe('MutationService', () => {
  it('builds install args for a named profile', async () => {
    const { calls, run } = okRunner();
    await svc(run).install('pub.ext', 'Work');
    expect(calls[0]).toEqual([
      '--user-data-dir', '/ud', '--extensions-dir', '/ed',
      '--profile', 'Work', '--install-extension', 'pub.ext',
    ]);
  });

  it('omits --profile for the default profile', async () => {
    const { calls, run } = okRunner();
    await svc(run).uninstall('pub.ext');
    expect(calls[0]).toEqual([
      '--user-data-dir', '/ud', '--extensions-dir', '/ed',
      '--uninstall-extension', 'pub.ext',
    ]);
  });

  it('rejects with MutationError carrying stderr on nonzero exit', async () => {
    const run = async () => ({ code: 1, stdout: '', stderr: 'nope' });
    await expect(svc(run).install('pub.ext', 'Work')).rejects.toThrowError(MutationError);
    await expect(svc(run).install('pub.ext', 'Work')).rejects.toThrow(/nope/);
  });

  it('rejects with MutationError for a profile name containing a double quote, without invoking the runner', async () => {
    const { calls, run } = okRunner();
    await expect(svc(run).install('pub.x', 'Bad"Name')).rejects.toThrowError(MutationError);
    expect(calls).toHaveLength(0);
  });

  it('queue survives a rejected call on the same instance', async () => {
    const calls: string[][] = [];
    let first = true;
    const run = async (_cli: string, args: string[]) => {
      calls.push(args);
      if (first) {
        first = false;
        return { code: 1, stdout: '', stderr: 'first fails' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const s = svc(run);
    await expect(s.install('pub.bad', 'Work')).rejects.toThrowError(MutationError);
    await expect(s.install('pub.good', 'Work')).resolves.toBeUndefined();
    expect(calls[1]).toEqual([
      '--user-data-dir', '/ud', '--extensions-dir', '/ed',
      '--profile', 'Work', '--install-extension', 'pub.good',
    ]);
  });

  it('falls back to stdout in MutationError when stderr is empty', async () => {
    const run = async () => ({ code: 1, stdout: 'boom-out', stderr: '' });
    await expect(svc(run).install('pub.ext', 'Work')).rejects.toThrow(/boom-out/);
  });

  it('serializes concurrent calls (FIFO, one at a time)', async () => {
    const order: string[] = [];
    let inFlight = 0;
    const run = async (_cli: string, args: string[]) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      order.push(args[args.length - 1] as string);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { code: 0, stdout: '', stderr: '' };
    };
    const s = svc(run);
    await Promise.all([s.install('pub.a', 'Work'), s.install('pub.b', 'Work'), s.uninstall('pub.c')]);
    expect(order).toEqual(['pub.a', 'pub.b', 'pub.c']);
  });
});
