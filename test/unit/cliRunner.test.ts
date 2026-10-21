import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSpawnCommand, CliArgumentError, CliTimeoutError, createCliRunner } from '../../src/core/cliRunner';
import type { Platform } from '../../src/core/paths';

/** True once `pid` no longer exists or is only a zombie awaiting reaping. */
const isGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw e;
  }
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim().startsWith('Z');
  } catch {
    return true; // ps exits nonzero when the pid vanished between the two checks
  }
};

const waitUntilGone = async (pid: number, withinMs: number): Promise<boolean> => {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (isGone(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return isGone(pid);
};

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

  it('spawns a Windows executable directly, without a shell or quoting', () => {
    const git = 'C:\\Program Files\\Git\\cmd\\git.exe';
    expect(buildSpawnCommand('win32', git, ['config', 'user.name', 'A "B" %C%'])).toEqual({
      command: git,
      args: ['config', 'user.name', 'A "B" %C%'],
      shell: false,
    });
  });

  it('treats .bat shims and upper-case extensions like .cmd', () => {
    expect(buildSpawnCommand('win32', 'C:\\tools\\CODE.CMD', []).shell).toBe(true);
    expect(buildSpawnCommand('win32', 'C:\\tools\\run.bat', []).shell).toBe(true);
  });

  it('refuses a percent sign for a Windows shim, since cmd.exe expands %VAR% inside quotes', () => {
    expect(() => buildSpawnCommand('win32', 'code.cmd', ['--profile', '%USERNAME%'])).toThrowError(
      CliArgumentError,
    );
    expect(() => buildSpawnCommand('win32', 'C:\\100%\\code.cmd', [])).toThrowError(CliArgumentError);
  });

  it('passes a percent sign through where no shell is involved', () => {
    expect(buildSpawnCommand('linux', '/usr/bin/code', ['%USERNAME%']).args).toEqual(['%USERNAME%']);
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
  const calls: { command: string; args: string[]; options: { shell: boolean; detached?: boolean } }[] = [];
  const children: FakeChild[] = [];
  const spawn = (command: string, args: string[], options: { shell: boolean; detached?: boolean }) => {
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

    it('rejects with CliTimeoutError and kills the whole process group', async () => {
      // The `code` launcher on macOS/Linux is a shell script that starts the real CLI as a
      // child, so signalling only the direct child could orphan the process doing the work.
      vi.useFakeTimers();
      const { calls, spawn } = fakeSpawn();
      const killed: [number, string][] = [];
      const killProcess = (pid: number, signal: NodeJS.Signals) => void killed.push([pid, signal]);
      const run = createCliRunner({ platform: 'linux', timeoutMs: 1000, spawn, killProcess });
      const result = run('/usr/bin/code', ['--install-extension', 'pub.ext']);
      const assertion = expect(result).rejects.toThrowError(CliTimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(calls[0]!.options.detached).toBe(true);
      expect(killed).toEqual([[-4242, 'SIGKILL']]);
    });

    it.skipIf(process.platform === 'win32')('kills a real background descendant on timeout (POSIX)', async () => {
      // A shell that backgrounds `sleep` stands in for the `code` launcher script. Signalling
      // only the shell would leave `sleep` running; the process-group kill must take it down.
      const dir = mkdtempSync(join(tmpdir(), 'personas-cli-'));
      const pidFile = join(dir, 'pid');
      try {
        const run = createCliRunner({ platform: process.platform as Platform, timeoutMs: 2000 });
        const result = run('/bin/sh', ['-c', `sleep 60 & echo $! > '${pidFile}'; wait`]);
        await expect(result).rejects.toThrowError(CliTimeoutError);
        const pid = Number(readFileSync(pidFile, 'utf8').trim());
        expect(pid).toBeGreaterThan(0);
        expect(await waitUntilGone(pid, 5000)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('does not time out a process that exits in time', async () => {
      vi.useFakeTimers();
      const { children, spawn } = fakeSpawn();
      const killed: number[] = [];
      const killProcess = (pid: number) => void killed.push(pid);
      const run = createCliRunner({ platform: 'linux', timeoutMs: 1000, spawn, killProcess });
      const result = run('/usr/bin/code', []);
      await vi.advanceTimersByTimeAsync(999);
      children[0]!.emit('close', 0);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(result).resolves.toMatchObject({ code: 0 });
      expect(killed).toEqual([]);
    });

    it('on Windows, kills the whole process tree behind the shell', async () => {
      vi.useFakeTimers();
      const { calls, children, spawn } = fakeSpawn();
      const run = createCliRunner({ platform: 'win32', timeoutMs: 1000, spawn });
      const result = run('C:\\code.cmd', []);
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
