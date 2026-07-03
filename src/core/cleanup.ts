import type { Inventory, OrphanInfo } from './types';

export async function buildOrphanInfos(
  inventory: Inventory,
  stat: (fsPath: string) => Promise<{ sizeBytes: number; lastModifiedMs: number }>,
): Promise<OrphanInfo[]> {
  const orphans: OrphanInfo[] = [];
  for (const ext of inventory.extensions) {
    if (!ext.orphaned || ext.versions.length === 0) continue;
    const folders = [];
    for (const v of ext.versions) {
      const s = await stat(v.fsPath);
      folders.push({
        folderName: v.folderName,
        fsPath: v.fsPath,
        sizeBytes: s.sizeBytes,
        lastModifiedMs: s.lastModifiedMs,
      });
    }
    orphans.push({
      id: ext.id,
      displayName: ext.displayName,
      folders,
      totalSizeBytes: folders.reduce((sum, f) => sum + f.sizeBytes, 0),
    });
  }
  return orphans;
}

export class CleanupService {
  constructor(private readonly trash: (fsPath: string) => Promise<void>) {}

  async deleteFolders(
    folders: { folderName: string; fsPath: string }[],
  ): Promise<{ folderName: string; ok: boolean; error?: string }[]> {
    const results: { folderName: string; ok: boolean; error?: string }[] = [];
    for (const f of folders) {
      try {
        await this.trash(f.fsPath);
        results.push({ folderName: f.folderName, ok: true });
      } catch (e) {
        results.push({ folderName: f.folderName, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return results;
  }
}
