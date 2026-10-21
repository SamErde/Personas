import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSpawnCommand, CliTimeoutError, createCliRunner } from '../../src/core/cliRunner';

describe('buildSpawnCommand', () => {
  it('spawns the CLI directly, without a shell, on non-Windows platforms', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(buildSpawnCommand(platform, '/usr/bin/code', ['--profile', 'My Work'])).toEqual({
        command: '/usr/bin/code',
        args: ['--profile', 'My Work'],
        shell: false,
      });
    }
  });

  it('quotes the .cmd shim and every arg through a shell on Windows', () => {
    expect(
      buildSpawnCommand('win32', 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd', [
        '--profile',
        'My Work',
        '--install-extension',
        'pub.ext',
      ]),
    ).toEqual({
      command: '"C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd"',
      args: ['"--profile"', '"My Work"', '"--install-extension"', '"pub.ext"'],
      shell: true,
    });
  });

  it('doubles embedded double quotes on Windows', () => {
    expect(buildSpawnCommand('win32', 'code.cmd', ['a"b']).args).toEqual(['"a""b"']);
  });
});

type FakeChild = EventEmitter & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  kill: () => boolean;
};

const fakeSpawn = () => {
  const calls: { command: string; args: string[]; options: { shell: boolean } }[] = [];
  const children: FakeChild[] = [];
  const spawn = (command: string, args: string[], options: { shell: boolean }) => {
    calls.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      killed: false,
      kill() {
        child.killed = true;
        return true;
      },
    });
    children.push(child);
    return child;
  };
  return { calls, children, spawn };
};

describe('createCliRunner', () => {
  it('resolves with the exit code and collected output', async () => {
    const { calls, children, spawn } = fakeSpawn();
    const run = createCliRunner({ platform: 'linux', timeoutMs: 1000, spawn });
    const result = run('/usr/bin/code', ['--list-extensions']);
    const child = children[0]!;
    child.stdout.emit('data', Buffer.from('pub.a\n'));
    child.stderr.emit('data', Buffer.from('warn'));
    child.emit('close', 0);
    await expect(result).resolves.toEqual({ code: 0, stdout: 'pub.a\n', stderr: 'warn' });
    expect(calls[0]).toMatchObject({ command: '/usr/bin/code', args: ['--list-extensions'], options: { shell: false } });
  });

  describe('when the CLI hangs', () => {
    afterEach(() => vi.useRealTimers());

    it('rejects with CliTimeoutError and kills the process', async () => {
      vi.useFakeTimers();
      const { children, spawn } = fakeSpawn();
      const run = createCliRunner({ platform: 'linux', timeoutMs: 1000, spawn });
      const result = run('/usr/bin/code', ['--install-extension', 'pub.ext']);
      const assertion = expect(result).rejects.toThrowError(CliTimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(children[0]!.killed).toBe(true);
    });

    it('does not time out a process that exits in time', async () => {
      vi.useFakeTimers();
      const { children, spawn } = fakeSpawn();
      const run = createCliRunner({ platform: 'linux', timeoutMs: 1000, spawn });
      const result = run('/usr/bin/code', []);
      await vi.advanceTimersByTimeAsync(999);
      children[0]!.emit('close', 0);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(result).resolves.toMatchObject({ code: 0 });
      expect(children[0]!.killed).toBe(false);
    });

    it('on Windows, kills the whole process tree behind the shell', async () => {
      vi.useFakeTimers();
      const { calls, children, spawn } = fakeSpawn();
      const run = createCliRunner({ platform: 'win32', timeoutMs: 1000, spawn });
      const result = run('C:\code.cmd', []);
      const assertion = expect(result).rejects.toThrowError(CliTimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(calls[1]).toEqual({
        command: 'taskkill',
        args: ['/pid', '4242', '/T', '/F'],
        options: { shell: false },
      });
      expect(children[1]!.listenerCount('error')).toBeGreaterThan(0);
    });
  });
});
