import { spawn as nodeSpawn } from 'node:child_process';
import type { Platform } from './paths';

export type CliResult = { code: number; stdout: string; stderr: string };

export type CliRunner = (cliPath: string, args: string[]) => Promise<CliResult>;

export class CliTimeoutError extends Error {
  constructor(cliPath: string, timeoutMs: number) {
    super(`${cliPath} did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped`);
    this.name = 'CliTimeoutError';
  }
}

export type SpawnCommand = { command: string; args: string[]; shell: boolean };

/** The slice of a spawned child process the runner depends on. */
export type CliChild = {
  pid?: number | undefined;
  stdout: NodeJS.EventEmitter | null;
  stderr: NodeJS.EventEmitter | null;
  kill(): boolean;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
};

export type CliSpawn = (command: string, args: string[], options: { shell: boolean }) => CliChild;

/**
 * How to spawn a CLI on a given platform. On Windows the `code` CLI is a .cmd batch shim,
 * which Node can only spawn through a shell; every arg is quoted to survive spaces in
 * profile names. Embedded quotes are CSV-style doubled, which is unproven against
 * CommandLineToArgvW's backslash rules — callers reject quote-bearing input up front.
 */
export function buildSpawnCommand(platform: Platform, cliPath: string, args: string[]): SpawnCommand {
  if (platform !== 'win32') return { command: cliPath, args, shell: false };
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  return { command: quote(cliPath), args: args.map(quote), shell: true };
}

const defaultSpawn: CliSpawn = (command, args, { shell }) => nodeSpawn(command, args, { shell, windowsHide: true });

/** Shared runner for the official CLIs Personas drives (`code`, `git`). */
export function createCliRunner(opts: { platform: Platform; timeoutMs: number; spawn?: CliSpawn }): CliRunner {
  const spawn = opts.spawn ?? defaultSpawn;
  // On Windows the child is the cmd.exe shell; killing it alone would orphan the CLI it
  // launched, so take down the whole tree. Best effort: a failed kill must not throw.
  const killTree = (child: CliChild) => {
    if (opts.platform === 'win32' && child.pid !== undefined) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false }).on('error', () => undefined);
    } else {
      child.kill();
    }
  };
  return (cliPath, args) =>
    new Promise((resolve, reject) => {
      const cmd = buildSpawnCommand(opts.platform, cliPath, args);
      const child = spawn(cmd.command, cmd.args, { shell: cmd.shell });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      // Settle on the timer rather than waiting for 'close': a hung process (or a grandchild
      // holding its stdio pipes open) may never close, and the caller's queue must move on.
      const timer = setTimeout(() => {
        settle(() => reject(new CliTimeoutError(cliPath, opts.timeoutMs)));
        killTree(child);
      }, opts.timeoutMs);
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', (err) => settle(() => reject(err)));
      child.on('close', (code) => settle(() => resolve({ code: code ?? -1, stdout, stderr })));
    });
}
