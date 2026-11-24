import * as fs from 'node:fs/promises';
import { pathFor, type Platform } from '../core/paths';

export type ExecutableLookup = {
  platform: Platform;
  env: NodeJS.ProcessEnv;
  /** Whether a path names an existing file. Defaults to asking the file system. */
  isFile?: (file: string) => Promise<boolean>;
};

const onDisk = (file: string) => fs.stat(file).then((stat) => stat.isFile(), () => false);

/** An environment variable by name; Windows names ignore case (`Path`, `PATH`). */
function variable(lookup: ExecutableLookup, name: string): string {
  if (lookup.platform !== 'win32') return lookup.env[name] ?? '';
  const key = Object.keys(lookup.env).find((candidate) => candidate.toUpperCase() === name);
  return (key === undefined ? undefined : lookup.env[key]) ?? '';
}

/** The file names a bare command may have: on Windows, one per `PATHEXT` extension. */
function fileNames(command: string, lookup: ExecutableLookup): string[] {
  const p = pathFor(lookup.platform);
  if (lookup.platform !== 'win32' || p.extname(command) !== '') return [command];
  const extensions = variable(lookup, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD';
  // Windows file names ignore case; lower case gives the usual spelling (`git.exe`).
  return extensions.split(';').filter(Boolean).map((extension) => command + extension.toLowerCase());
}

/** Looks a bare command up in the absolute folders of `PATH`, and nowhere else. */
async function onPath(command: string, lookup: ExecutableLookup): Promise<string | undefined> {
  const p = pathFor(lookup.platform);
  const isFile = lookup.isFile ?? onDisk;
  // A relative or empty entry means "the current folder", which is the folder being inspected.
  const folders = variable(lookup, 'PATH').split(p.delimiter).filter((folder) => p.isAbsolute(folder));
  for (const folder of folders) {
    for (const name of fileNames(command, lookup)) {
      const candidate = p.join(folder, name);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

async function resolveOne(candidate: string, lookup: ExecutableLookup): Promise<string | undefined> {
  const p = pathFor(lookup.platform);
  if (p.isAbsolute(candidate)) return (await (lookup.isFile ?? onDisk)(candidate)) ? candidate : undefined;
  // A bare name is looked up on PATH; a relative path would depend on the folder Git runs in.
  return p.basename(candidate) === candidate ? onPath(candidate, lookup) : undefined;
}

/**
 * The absolute path of the Git executable to run: the first entry of `configured` (VS Code's
 * `git.path` setting) that exists, otherwise `git` on `PATH`. Undefined when there is none.
 *
 * Resolved before Git runs in any workspace folder, and never from that folder: started by bare
 * name on Windows, a `git.exe` planted beside the file being inspected would be found first.
 */
export async function findGitExecutable(configured: readonly string[], lookup: ExecutableLookup): Promise<string | undefined> {
  for (const candidate of [...configured, 'git']) {
    const found = await resolveOne(candidate, lookup);
    if (found !== undefined) return found;
  }
  return undefined;
}
