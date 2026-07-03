import { spawn } from 'node:child_process';

export class MutationError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(`${message}${stderr ? `: ${stderr.trim()}` : ''}`);
    this.name = 'MutationError';
  }
}

export type CliRunner = (
  cliPath: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export class MutationService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly opts: { cliPath: string; extraArgs: string[]; run: CliRunner },
  ) {}

  install(extId: string, profileName?: string): Promise<void> {
    return this.enqueue('install failed', profileName, [
      ...this.profileArgs(profileName),
      '--install-extension',
      extId,
    ]);
  }

  uninstall(extId: string, profileName?: string): Promise<void> {
    return this.enqueue('uninstall failed', profileName, [
      ...this.profileArgs(profileName),
      '--uninstall-extension',
      extId,
    ]);
  }

  private profileArgs(profileName?: string): string[] {
    return profileName === undefined ? [] : ['--profile', profileName];
  }

  private enqueue(errorLabel: string, profileName: string | undefined, args: string[]): Promise<void> {
    const task = this.queue.then(async () => {
      // Windows quoting in createNodeCliRunner escapes embedded quotes via CSV-style
      // doubling, which is unproven against CommandLineToArgvW's backslash-escaping rules.
      // Reject up front rather than risk silently targeting the wrong (or a malformed) profile.
      if (profileName?.includes('"')) {
        throw new MutationError('unsupported profile name (contains ")', '');
      }
      const full = [...this.opts.extraArgs, ...args];
      const result = await this.opts.run(this.opts.cliPath, full);
      if (result.code !== 0) throw new MutationError(errorLabel, result.stderr || result.stdout);
    });
    // Keep the chain alive even when a task rejects.
    this.queue = task.catch(() => undefined);
    return task;
  }
}

/**
 * Real CLI runner. On Windows the CLI is a .cmd batch shim, which Node can only
 * spawn through a shell; every arg is quoted to survive spaces in profile names.
 */
export function createNodeCliRunner(): CliRunner {
  return (cliPath, args) =>
    new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
      const child = isWin
        ? spawn(quote(cliPath), args.map(quote), { shell: true, windowsHide: true })
        : spawn(cliPath, args, { shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}
