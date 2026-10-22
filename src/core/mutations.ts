import type { CliRunner } from './cliRunner';

export class MutationError extends Error {
  constructor(message: string, stderr: string) {
    super(`${message}${stderr ? `: ${stderr.trim()}` : ''}`);
    this.name = 'MutationError';
  }
}

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
      // The Windows shim quoting can't safely carry embedded quotes (see buildSpawnCommand).
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
