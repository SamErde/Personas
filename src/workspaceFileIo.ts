import { constants } from 'node:fs';
import { open, lstat, opendir, realpath, type FileHandle } from 'node:fs/promises';
import { isFsPathContained } from './core/workspace';

interface WorkspaceDirectoryEntry {
  name: string;
  isDirectory(): boolean;
}

interface WorkspaceDirectoryReader {
  read(): Promise<WorkspaceDirectoryEntry | null>;
  close(): Promise<void>;
}

type OpenWorkspaceDirectory = (p: string) => Promise<WorkspaceDirectoryReader>;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Enumerate only enough workspace-controlled entries to fill the cap and detect truncation. */
export async function listBoundedWorkspaceEntries(
  p: string,
  maxEntries: number,
  openDirectory: OpenWorkspaceDirectory = opendir,
): Promise<{ name: string; isDirectory: boolean }[] | Error> {
  let directory: WorkspaceDirectoryReader | undefined;
  try {
    directory = await openDirectory(p);
    const entries: { name: string; isDirectory: boolean }[] = [];
    while (entries.length <= maxEntries) {
      const entry = await directory.read();
      if (!entry) break;
      entries.push({ name: entry.name, isDirectory: entry.isDirectory() });
    }
    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return asError(error);
  } finally {
    if (directory) {
      try {
        await directory.close();
      } catch {
        // A failed close cannot make already bounded directory metadata unsafe to consume.
      }
    }
  }
}

async function openManifest(p: string): Promise<FileHandle | undefined | Error> {
  const flags =
    constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0);
  try {
    return await open(p, flags);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return asError(error);
  }
}

/**
 * Read an untrusted workspace manifest without a check-then-open race. The file is opened once,
 * validated and bounded through that handle, and read only from that same handle. Path checks run
 * afterwards to decide whether the already-bounded bytes may be accepted; no path-based read
 * follows them. `O_NOFOLLOW`/`O_NONBLOCK` also prevent POSIX symlinks to devices and FIFOs from
 * turning the open into an unbounded operation.
 */
export async function readBoundedWorkspaceManifest(
  p: string,
  extensionsRoot: string,
  maxBytes: number,
): Promise<string | undefined | Error> {
  const opened = await openManifest(p);
  if (opened === undefined || opened instanceof Error) return opened;

  try {
    const openedStat = await opened.stat();
    if (!openedStat.isFile()) return new Error('manifest is not a regular file.');
    if (openedStat.size > maxBytes) return new Error(`manifest exceeds ${maxBytes} bytes.`);

    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const next = await opened.read(buffer, total, buffer.length - total, null);
      if (next.bytesRead === 0) break;
      total += next.bytesRead;
    }
    if (total > maxBytes) return new Error(`manifest exceeds ${maxBytes} bytes.`);

    const [pathStat, realRoot, realManifest] = await Promise.all([
      lstat(p),
      realpath(extensionsRoot),
      realpath(p),
    ]);
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      return new Error('manifest is not a regular file.');
    }
    if (openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) {
      return new Error('manifest changed while it was being read.');
    }
    if (!isFsPathContained(realRoot, realManifest)) {
      return new Error(`manifest resolves outside ${extensionsRoot}.`);
    }
    return buffer.subarray(0, total).toString('utf8');
  } catch (error) {
    return asError(error);
  } finally {
    await opened.close();
  }
}
