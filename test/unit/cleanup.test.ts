import { describe, expect, it } from 'vitest';
import { buildOrphanInfos, CleanupService } from '../../src/core/cleanup';
import type { Inventory } from '../../src/core/types';

const inventory: Inventory = {
  profiles: [{ id: 'default', name: 'Default', isDefault: true, inheritsDefaultExtensions: false }],
  extensions: [
    {
      id: 'pub.kept', displayName: 'Kept', applyToAllProfiles: false, installedIn: ['default'], orphaned: false,
      versions: [{ version: '1.0.0', folderName: 'pub.kept-1.0.0', fsPath: '/x/pub.kept-1.0.0' }],
    },
    {
      id: 'pub.orphan', displayName: 'Orphan', applyToAllProfiles: false, installedIn: [], orphaned: true,
      versions: [
        { version: '1.0.0', folderName: 'pub.orphan-1.0.0', fsPath: '/x/pub.orphan-1.0.0' },
        { version: '2.0.0', folderName: 'pub.orphan-2.0.0', fsPath: '/x/pub.orphan-2.0.0' },
      ],
    },
  ],
  warnings: [],
};

describe('buildOrphanInfos', () => {
  it('collects only orphaned extensions with sizes summed across versions', async () => {
    const orphans = await buildOrphanInfos(inventory, async (p) => ({
      sizeBytes: p.endsWith('1.0.0') ? 100 : 250,
      lastModifiedMs: 42,
    }));
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.id).toBe('pub.orphan');
    expect(orphans[0]?.totalSizeBytes).toBe(350);
    expect(orphans[0]?.folders.map((f) => f.folderName)).toEqual(['pub.orphan-1.0.0', 'pub.orphan-2.0.0']);
  });
});

describe('CleanupService', () => {
  it('trashes each folder and reports per-item results, continuing past failures', async () => {
    const trashed: string[] = [];
    const svc = new CleanupService(async (p) => {
      if (p.includes('2.0.0')) throw new Error('locked');
      trashed.push(p);
    });
    const results = await svc.deleteFolders([
      { folderName: 'pub.orphan-1.0.0', fsPath: '/x/pub.orphan-1.0.0' },
      { folderName: 'pub.orphan-2.0.0', fsPath: '/x/pub.orphan-2.0.0' },
    ]);
    expect(trashed).toEqual(['/x/pub.orphan-1.0.0']);
    expect(results).toEqual([
      { folderName: 'pub.orphan-1.0.0', ok: true },
      { folderName: 'pub.orphan-2.0.0', ok: false, error: 'locked' },
    ]);
  });
});
