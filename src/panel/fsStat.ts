/**
 * Recursively sums file sizes and finds the newest mtime under `fsPath`. Shared by MatrixPanel's
 * orphan listing and Home's orphan-size line — both feed the result into
 * `buildOrphanInfos`'s `stat` callback.
 */
export async function statFolder(fsPath: string): Promise<{ sizeBytes: number; lastModifiedMs: number }> {
  const { readdir, stat } = await import('node:fs/promises');
  const path = await import('node:path');
  let total = 0;
  let newest = 0;

  // One unreadable directory must not abort the whole orphan listing — skip it and keep walking.
  async function tryReaddir(dir: string) {
    try {
      return await readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
  }

  async function walk(dir: string): Promise<void> {
    const entries = await tryReaddir(dir);
    if (!entries) return;
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
      } else {
        // One unreadable/removed file (e.g. a race with deletion) must not abort the walk —
        // skip it and keep totals best-effort.
        try {
          const s = await stat(p);
          total += s.size;
          if (s.mtimeMs > newest) newest = s.mtimeMs;
        } catch {
          // skip
        }
      }
    }
  }
  await walk(fsPath);
  return { sizeBytes: total, lastModifiedMs: newest };
}
