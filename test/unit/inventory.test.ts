import { describe, expect, it } from 'vitest';
import { composeInventory, InventoryService, type InventoryIo } from '../../src/core/inventory';
import type { ResolvedPaths } from '../../src/core/paths';
import type { ManifestEntry, RawProfile } from '../../src/core/parsers';

const entry = (id: string, version: string, appScoped = false): ManifestEntry => ({
  id,
  version,
  relativeLocation: `${id}-${version}`,
  isApplicationScoped: appScoped,
});

const baseInput = () => ({
  rawProfiles: [
    { location: 'aaa', name: 'Work', inheritsDefaultExtensions: false },
    { location: 'builtin/agents', name: 'Agents', inheritsDefaultExtensions: true },
  ] as RawProfile[],
  defaultManifest: [entry('pub.everywhere', '1.0.0', true), entry('pub.default-only', '2.0.0')] as ManifestEntry[] | Error,
  profileManifests: new Map<string, ManifestEntry[] | Error>([['aaa', [entry('pub.work-only', '3.0.0')]]]),
  diskFolders: [
    'pub.everywhere-1.0.0',
    'pub.default-only-2.0.0',
    'pub.work-only-3.0.0',
    'pub.orphan-9.9.9',
  ],
  obsoleteFolderNames: [] as string[],
  displayNames: new Map<string, string>([['pub.everywhere', 'Everywhere!']]),
  extensionsDir: '/x',
});

describe('composeInventory', () => {
  it('lists default profile first, then registry profiles', () => {
    const inv = composeInventory(baseInput());
    expect(inv.profiles.map((p) => p.id)).toEqual(['default', 'aaa', 'builtin/agents']);
    expect(inv.profiles[0]?.isDefault).toBe(true);
    expect(inv.profiles[2]?.inheritsDefaultExtensions).toBe(true);
  });

  it('marks app-scoped extensions installed in every profile', () => {
    const inv = composeInventory(baseInput());
    const everywhere = inv.extensions.find((e) => e.id === 'pub.everywhere');
    expect(everywhere?.applyToAllProfiles).toBe(true);
    expect(everywhere?.installedIn).toEqual(['default', 'aaa', 'builtin/agents']);
    expect(everywhere?.displayName).toBe('Everywhere!');
  });

  it('propagates default membership to inheriting profiles', () => {
    const inv = composeInventory(baseInput());
    const defOnly = inv.extensions.find((e) => e.id === 'pub.default-only');
    expect(defOnly?.installedIn).toEqual(['default', 'builtin/agents']);
  });

  it('flags orphans: on disk, in no profile, not app-scoped', () => {
    const inv = composeInventory(baseInput());
    const orphan = inv.extensions.find((e) => e.id === 'pub.orphan');
    expect(orphan?.orphaned).toBe(true);
    expect(orphan?.installedIn).toEqual([]);
    expect(orphan?.versions).toEqual([
      { version: '9.9.9', folderName: 'pub.orphan-9.9.9', fsPath: '/x/pub.orphan-9.9.9' },
    ]);
    expect(inv.extensions.filter((e) => e.orphaned)).toHaveLength(1);
  });

  it('does not flag obsolete folders as orphans', () => {
    const input = baseInput();
    input.obsoleteFolderNames = ['pub.orphan-9.9.9'];
    const inv = composeInventory(input);
    expect(inv.extensions.find((e) => e.id === 'pub.orphan')).toBeUndefined();
  });

  it('turns a failed profile manifest into a warning and disables that profile', () => {
    const input = baseInput();
    input.profileManifests.set('aaa', new Error('boom'));
    const inv = composeInventory(input);
    expect(inv.warnings).toHaveLength(1);
    expect(inv.warnings[0]?.affectedProfileIds).toEqual(['aaa']);
    expect(inv.extensions.find((e) => e.id === 'pub.work-only')).toBeUndefined();
  });

  it('falls back to id as displayName', () => {
    const inv = composeInventory(baseInput());
    expect(inv.extensions.find((e) => e.id === 'pub.default-only')?.displayName).toBe('pub.default-only');
  });

  it('sorts extensions by displayName, case-insensitive', () => {
    const inv = composeInventory(baseInput());
    const names = inv.extensions.map((e) => e.displayName.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it('suppresses disk-only records too when a profile manifest fails', () => {
    // Disk-only ids are indistinguishable from the failed profile's extensions,
    // so orphan reporting is withheld rather than guessed.
    const input = baseInput();
    input.profileManifests.set('aaa', new Error('boom'));
    const inv = composeInventory(input);
    expect(inv.extensions.find((e) => e.id === 'pub.orphan')).toBeUndefined();
    expect(inv.extensions.some((e) => e.orphaned)).toBe(false);
  });
});

describe('InventoryService', () => {
  const PATHS: ResolvedPaths = {
    userDataDir: '/data',
    userDir: '/data/User',
    storageJson: '/data/User/globalStorage/storage.json',
    profilesDir: '/data/User/profiles',
    extensionsDir: '/ext',
    globalExtensionsJson: '/ext/extensions.json',
    obsoleteFile: '/ext/.obsolete',
  };

  const makeIo = (
    files: Record<string, string>,
    dirs: string[] = [],
    displayNames: Record<string, string> = {},
  ): InventoryIo => ({
    readFile: (p) => Promise.resolve(files[p]),
    listDirs: () => Promise.resolve(dirs),
    readDisplayName: (p) => Promise.resolve(displayNames[p]),
  });

  const storageJson = JSON.stringify({ userDataProfiles: [{ location: 'aaa', name: 'Work' }] });
  const defaultManifest = JSON.stringify([
    { identifier: { id: 'pub.alpha' }, version: '1.0.0', relativeLocation: 'pub.alpha-1.0.0' },
  ]);
  const profileManifest = JSON.stringify([
    { identifier: { id: 'pub.beta' }, version: '2.0.0', relativeLocation: 'pub.beta-2.0.0' },
  ]);

  it('wires profiles, manifests, disk folders and display names end-to-end', async () => {
    const io = makeIo(
      {
        [PATHS.storageJson]: storageJson,
        [PATHS.globalExtensionsJson]: defaultManifest,
        '/data/User/profiles/aaa/extensions.json': profileManifest,
      },
      ['pub.alpha-1.0.0', 'pub.beta-2.0.0'],
      { '/ext/pub.alpha-1.0.0': 'Alpha!' },
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    expect(inv.warnings).toEqual([]);
    expect(inv.profiles.map((p) => p.id)).toEqual(['default', 'aaa']);
    const alpha = inv.extensions.find((e) => e.id === 'pub.alpha');
    expect(alpha?.displayName).toBe('Alpha!');
    expect(alpha?.installedIn).toEqual(['default']);
    expect(alpha?.versions).toEqual([
      { version: '1.0.0', folderName: 'pub.alpha-1.0.0', fsPath: '/ext/pub.alpha-1.0.0' },
    ]);
    const beta = inv.extensions.find((e) => e.id === 'pub.beta');
    expect(beta?.installedIn).toEqual(['aaa']);
    expect(beta?.displayName).toBe('pub.beta');
    expect(inv.extensions.some((e) => e.orphaned)).toBe(false);
  });

  it('degrades a corrupt storage.json into a registry-wide warning without rejecting', async () => {
    const io = makeIo({ [PATHS.storageJson]: '{{{' });
    const inv = await new InventoryService(PATHS, io).getInventory();
    expect(inv.profiles.map((p) => p.id)).toEqual(['default']);
    expect(inv.warnings).toHaveLength(1);
    expect(inv.warnings[0]?.file).toBe('globalStorage/storage.json');
    expect(inv.warnings[0]?.affectedProfileIds).toEqual(['default']);
  });

  it('degrades a corrupt .obsolete into a warning and suppresses disk-only orphans', async () => {
    const io = makeIo(
      {
        [PATHS.storageJson]: storageJson,
        [PATHS.globalExtensionsJson]: defaultManifest,
        '/data/User/profiles/aaa/extensions.json': profileManifest,
        [PATHS.obsoleteFile]: '{{{',
      },
      ['pub.alpha-1.0.0', 'pub.stale-0.0.1'],
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    const warning = inv.warnings.find((w) => w.file === 'extensions/.obsolete');
    expect(warning).toBeDefined();
    expect(warning?.affectedProfileIds).toEqual([]);
    // Without a readable .obsolete we cannot tell stale folders from orphans — suppress, don't guess.
    expect(inv.extensions.find((e) => e.id === 'pub.stale')).toBeUndefined();
    expect(inv.extensions.find((e) => e.id === 'pub.alpha')?.orphaned).toBe(false);
  });

  it('does not report app-scoped-on-disk extensions as orphans when the default manifest is corrupt', async () => {
    // pub.appscoped's isApplicationScoped flag lives in the unreadable default manifest;
    // flagging it orphaned would be a guess, so it is suppressed instead.
    const io = makeIo(
      { [PATHS.storageJson]: storageJson, [PATHS.globalExtensionsJson]: '{{{' },
      ['pub.appscoped-1.0.0'],
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    const warning = inv.warnings.find((w) => w.file === 'extensions.json (default profile)');
    expect(warning).toBeDefined();
    expect(warning?.affectedProfileIds).toEqual(['default']);
    expect(inv.extensions.find((e) => e.id === 'pub.appscoped')).toBeUndefined();
    expect(inv.extensions.some((e) => e.orphaned)).toBe(false);
  });
});
