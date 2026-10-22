import { describe, expect, it } from 'vitest';
import {
  composeInventory,
  directInstallProfileIds,
  installInEveryProfileTargets,
  profileExtensionCounts,
  profileManifestPath,
  removeFromEveryProfileTargets,
  InventoryService,
  type InventoryIo,
} from '../../src/core/inventory';
import type { ResolvedPaths } from '../../src/core/paths';
import type { ManifestEntry, RawProfile } from '../../src/core/parsers';
import type { Inventory, Profile } from '../../src/core/types';

const entry = (id: string, version: string, applyToAllProfiles = false): ManifestEntry => ({
  id,
  version,
  applyToAllProfiles,
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
  platform: 'linux' as const,
});

describe('composeInventory', () => {
  it('lists default profile first, then registry profiles', () => {
    const inv = composeInventory(baseInput());
    expect(inv.profiles.map((p) => p.id)).toEqual(['default', 'aaa', 'builtin/agents']);
    expect(inv.profiles[0]?.isDefault).toBe(true);
    expect(inv.profiles[2]?.inheritsDefaultExtensions).toBe(true);
  });

  it('disables changes to every profile sharing a name, since the code CLI targets profiles by name', () => {
    const input = baseInput();
    input.rawProfiles.push(
      { location: 'bbb', name: 'Work', inheritsDefaultExtensions: false },
      { location: 'ccc', name: 'Home', inheritsDefaultExtensions: false },
    );
    const inv = composeInventory(input);
    expect(inv.warnings).toEqual([
      {
        file: 'globalStorage/storage.json',
        message:
          'More than one profile is named "Work". The code CLI picks a profile by name, so Personas cannot ' +
          'tell which one a change would reach. Rename one of them in VS Code',
        affectedProfileIds: ['aaa', 'bbb'],
        kind: 'duplicateName',
      },
    ]);
    expect(installInEveryProfileTargets(inv, 'pub.work-only').map((p) => p.id)).toEqual(['default', 'ccc']);
  });

  it('disables changes to a named profile called "Default", which --profile Default cannot reach', () => {
    const input = baseInput();
    input.rawProfiles.push(
      { location: 'ddd', name: 'Default', inheritsDefaultExtensions: false },
      // Names match case-sensitively, so these stay reachable.
      { location: 'eee', name: 'default', inheritsDefaultExtensions: false },
      { location: 'fff', name: 'work', inheritsDefaultExtensions: false },
    );
    const inv = composeInventory(input);
    expect(inv.warnings).toEqual([
      {
        file: 'globalStorage/storage.json',
        message:
          'A profile is named "Default". The code CLI sends --profile Default to the built-in Default profile, ' +
          'so a change to this one would land there instead. Rename it in VS Code',
        affectedProfileIds: ['ddd'],
        kind: 'duplicateName',
      },
    ]);
  });

  it('marks extensions applied to all profiles as installed in every profile', () => {
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
    expect(defOnly?.profileVersions).toEqual([
      { profileId: 'default', version: '2.0.0' },
      { profileId: 'builtin/agents', version: '2.0.0' },
    ]);
  });

  it('preserves the manifest-selected version independently for each profile', () => {
    const input = baseInput();
    input.rawProfiles = [{ location: 'aaa', name: 'Work', inheritsDefaultExtensions: false }];
    input.defaultManifest = [entry('pub.shared', '1.0.0')];
    input.profileManifests = new Map([['aaa', [entry('pub.shared', '2.0.0')]]]);
    input.diskFolders = ['pub.shared-1.0.0', 'pub.shared-2.0.0'];
    const shared = composeInventory(input).extensions.find((extension) => extension.id === 'pub.shared');
    expect(shared?.profileVersions).toEqual([
      { profileId: 'default', version: '1.0.0' },
      { profileId: 'aaa', version: '2.0.0' },
    ]);
  });

  it('flags orphans: on disk, in no profile, not applied to all profiles', () => {
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

  it('adds description/publisher from the descriptions/publishers maps, leaving other extensions without them', () => {
    const input = baseInput();
    const inv = composeInventory({
      ...input,
      descriptions: new Map([['pub.everywhere', 'Does everything.']]),
      publishers: new Map([['pub.everywhere', 'pub']]),
    });
    const everywhere = inv.extensions.find((e) => e.id === 'pub.everywhere');
    expect(everywhere?.description).toBe('Does everything.');
    expect(everywhere?.publisher).toBe('pub');
    const other = inv.extensions.find((e) => e.id === 'pub.default-only');
    expect(other?.description).toBeUndefined();
    expect(other?.publisher).toBeUndefined();
  });

  it('takes publisherDisplayName/installedTimestamp from the first manifest entry that carries each field', () => {
    const input = baseInput();
    input.defaultManifest = [
      { ...entry('pub.everywhere', '1.0.0', true), installedTimestamp: 111 },
      entry('pub.default-only', '2.0.0'),
    ];
    input.profileManifests.set('aaa', [
      { ...entry('pub.work-only', '3.0.0'), publisherDisplayName: 'Work Pub', installedTimestamp: 222 },
    ]);
    const inv = composeInventory(input);
    const everywhere = inv.extensions.find((e) => e.id === 'pub.everywhere');
    expect(everywhere?.installedTimestampMs).toBe(111);
    expect(everywhere?.publisherDisplayName).toBeUndefined();
    const workOnly = inv.extensions.find((e) => e.id === 'pub.work-only');
    expect(workOnly?.publisherDisplayName).toBe('Work Pub');
    expect(workOnly?.installedTimestampMs).toBe(222);
  });

  it('prefers the default manifest entry over a profile manifest entry for the same id', () => {
    const input = baseInput();
    input.rawProfiles = [{ location: 'aaa', name: 'Work', inheritsDefaultExtensions: false }];
    input.defaultManifest = [{ ...entry('pub.shared', '1.0.0'), publisherDisplayName: 'Default Wins' }];
    input.profileManifests = new Map([
      ['aaa', [{ ...entry('pub.shared', '1.0.0'), publisherDisplayName: 'Profile Loses' }]],
    ]);
    const inv = composeInventory(input);
    expect(inv.extensions.find((e) => e.id === 'pub.shared')?.publisherDisplayName).toBe('Default Wins');
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
    platform: 'linux',
  };

  const makeIo = (
    files: Record<string, string | Error>,
    dirs: string[] | Error = [],
    displayNames: Record<string, string> = {},
    icons: Record<string, string> = {},
  ): InventoryIo => ({
    readFile: (p) => Promise.resolve(files[p]),
    listDirs: () => Promise.resolve(dirs),
    readPackageMeta: (p) =>
      Promise.resolve(
        displayNames[p] !== undefined || icons[p] !== undefined
          ? { displayName: displayNames[p], icon: icons[p] }
          : undefined,
      ),
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
      { '/ext/pub.alpha-1.0.0': 'media/icon.png' },
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
    // package.json declared an icon — the record gets its absolute, folder-relative fsPath.
    expect(alpha?.iconFsPath).toBe('/ext/pub.alpha-1.0.0/media/icon.png');
    const beta = inv.extensions.find((e) => e.id === 'pub.beta');
    expect(beta?.installedIn).toEqual(['aaa']);
    expect(beta?.displayName).toBe('pub.beta');
    // No icon declared for beta — the field is absent, not an empty string.
    expect(beta?.iconFsPath).toBeUndefined();
    expect(inv.extensions.some((e) => e.orphaned)).toBe(false);
  });

  it('watches the registry file, the extensions pool and profile manifests — not whole trees', () => {
    expect(new InventoryService(PATHS, makeIo({})).watchedTargets()).toEqual([
      { baseFsPath: '/data/User/globalStorage', pattern: 'storage.json' },
      // Top level only: extensions.json, .obsolete, and version folders appearing or disappearing.
      { baseFsPath: '/ext', pattern: '*' },
      // Profile locations can nest (builtin/agents), so manifests are matched at any depth.
      { baseFsPath: '/data/User/profiles', pattern: '**/extensions.json' },
    ]);
  });

  it('builds every path with the platform separator on Windows', async () => {
    const WIN: ResolvedPaths = {
      userDataDir: 'C:\\Data',
      userDir: 'C:\\Data\\User',
      storageJson: 'C:\\Data\\User\\globalStorage\\storage.json',
      profilesDir: 'C:\\Data\\User\\profiles',
      extensionsDir: 'C:\\Ext',
      globalExtensionsJson: 'C:\\Ext\\extensions.json',
      obsoleteFile: 'C:\\Ext\\.obsolete',
      platform: 'win32',
    };
    const io = makeIo(
      {
        [WIN.storageJson]: storageJson,
        [WIN.globalExtensionsJson]: defaultManifest,
        'C:\\Data\\User\\profiles\\aaa\\extensions.json': profileManifest,
      },
      ['pub.alpha-1.0.0', 'pub.beta-2.0.0'],
      {},
      { 'C:\\Ext\\pub.alpha-1.0.0': 'media/icon.png' },
    );
    const inv = await new InventoryService(WIN, io).getInventory();
    expect(inv.extensions.find((e) => e.id === 'pub.beta')?.installedIn).toEqual(['aaa']);
    const alpha = inv.extensions.find((e) => e.id === 'pub.alpha');
    expect(alpha?.versions[0]?.fsPath).toBe('C:\\Ext\\pub.alpha-1.0.0');
    expect(alpha?.iconFsPath).toBe('C:\\Ext\\pub.alpha-1.0.0\\media\\icon.png');
  });

  it('keeps a backslash in a POSIX directory name as part of the name', async () => {
    const odd: ResolvedPaths = {
      ...PATHS,
      profilesDir: '/data/odd\\name',
      extensionsDir: '/ext/odd\\name',
      globalExtensionsJson: '/ext/odd\\name/extensions.json',
    };
    const io = makeIo(
      {
        [odd.storageJson]: storageJson,
        [odd.globalExtensionsJson]: defaultManifest,
        '/data/odd\\name/aaa/extensions.json': profileManifest,
      },
      ['pub.alpha-1.0.0'],
      {},
      { '/ext/odd\\name/pub.alpha-1.0.0': 'media/icon.png' },
    );
    const inv = await new InventoryService(odd, io).getInventory();
    expect(inv.extensions.find((e) => e.id === 'pub.beta')?.installedIn).toEqual(['aaa']);
    const alpha = inv.extensions.find((e) => e.id === 'pub.alpha');
    expect(alpha?.versions[0]?.fsPath).toBe('/ext/odd\\name/pub.alpha-1.0.0');
    expect(alpha?.iconFsPath).toBe('/ext/odd\\name/pub.alpha-1.0.0/media/icon.png');
  });

  it('wires description and publisher from readPackageMeta through to the extension record', async () => {
    const io: InventoryIo = {
      readFile: (p) =>
        Promise.resolve(
          ({ [PATHS.storageJson]: storageJson, [PATHS.globalExtensionsJson]: defaultManifest } as Record<
            string,
            string
          >)[p],
        ),
      listDirs: () => Promise.resolve(['pub.alpha-1.0.0']),
      readPackageMeta: () =>
        Promise.resolve({ displayName: 'Alpha!', description: 'Does alpha things.', publisher: 'pub' }),
    };
    const inv = await new InventoryService(PATHS, io).getInventory();
    const alpha = inv.extensions.find((e) => e.id === 'pub.alpha');
    expect(alpha?.description).toBe('Does alpha things.');
    expect(alpha?.publisher).toBe('pub');
  });

  it('rejects icon paths with .. segments or a drive letter — record gets no iconFsPath', async () => {
    // Defense in depth: package.json `icon` is attacker-controlled data from an installed
    // extension's folder. Containment must not rely solely on the webview's localResourceRoots.
    const io = makeIo(
      {
        [PATHS.storageJson]: storageJson,
        [PATHS.globalExtensionsJson]: defaultManifest,
      },
      ['pub.alpha-1.0.0', 'pub.beta-2.0.0'],
      {},
      {
        '/ext/pub.alpha-1.0.0': '../../evil.png',
        '/ext/pub.beta-2.0.0': 'C:/evil.png',
      },
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    expect(inv.extensions.find((e) => e.id === 'pub.alpha')?.iconFsPath).toBeUndefined();
    expect(inv.extensions.find((e) => e.id === 'pub.beta')?.iconFsPath).toBeUndefined();
  });

  it('rejects leading-slash and backslash-traversal icon paths but keeps safe nested ones', async () => {
    const io = makeIo(
      {
        [PATHS.storageJson]: storageJson,
        [PATHS.globalExtensionsJson]: defaultManifest,
      },
      ['pub.alpha-1.0.0', 'pub.beta-2.0.0', 'pub.gamma-3.0.0'],
      {},
      {
        '/ext/pub.alpha-1.0.0': '/etc/evil.png',
        '/ext/pub.beta-2.0.0': 'media\\..\\..\\evil.png',
        '/ext/pub.gamma-3.0.0': 'media/icons/icon.png', // safe — must still resolve
      },
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    expect(inv.extensions.find((e) => e.id === 'pub.alpha')?.iconFsPath).toBeUndefined();
    expect(inv.extensions.find((e) => e.id === 'pub.beta')?.iconFsPath).toBeUndefined();
    expect(inv.extensions.find((e) => e.id === 'pub.gamma')?.iconFsPath).toBe(
      '/ext/pub.gamma-3.0.0/media/icons/icon.png',
    );
  });

  it('uses the icon from the first disk version folder that has one, skipping iconless versions', async () => {
    const io = makeIo(
      {
        [PATHS.storageJson]: storageJson,
        [PATHS.globalExtensionsJson]: defaultManifest,
      },
      ['pub.alpha-1.0.0', 'pub.alpha-0.9.0'],
      {},
      { '/ext/pub.alpha-0.9.0': 'icon.png' },
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    const alpha = inv.extensions.find((e) => e.id === 'pub.alpha');
    expect(alpha?.iconFsPath).toBe('/ext/pub.alpha-0.9.0/icon.png');
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

  it('suppresses orphan reporting when the profile registry is unreadable', async () => {
    // With storage.json unreadable, named profiles are invisible and their extensions look
    // disk-only (e.g. pub.hidden) — suppress orphan reporting rather than guess.
    const io = makeIo(
      { [PATHS.storageJson]: '{{{', [PATHS.globalExtensionsJson]: defaultManifest },
      ['pub.alpha-1.0.0', 'pub.hidden-4.0.0'],
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    expect(inv.warnings[0]?.file).toBe('globalStorage/storage.json');
    expect(inv.extensions.find((e) => e.id === 'pub.hidden')).toBeUndefined();
    expect(inv.extensions.find((e) => e.id === 'pub.alpha')?.orphaned).toBe(false);
    expect(inv.extensions.some((e) => e.orphaned)).toBe(false);
  });

  it('does not report on-disk extensions applied to all profiles as orphans when the default manifest is corrupt', async () => {
    // pub.applied-to-all's applied-to-all-profiles flag lives in the unreadable default manifest;
    // flagging it orphaned would be a guess, so it is suppressed instead.
    const io = makeIo(
      { [PATHS.storageJson]: storageJson, [PATHS.globalExtensionsJson]: '{{{' },
      ['pub.applied-to-all-1.0.0'],
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    const warning = inv.warnings.find((w) => w.file === 'extensions.json (default profile)');
    expect(warning).toBeDefined();
    expect(warning?.affectedProfileIds).toEqual(['default']);
    expect(inv.extensions.find((e) => e.id === 'pub.applied-to-all')).toBeUndefined();
    expect(inv.extensions.some((e) => e.orphaned)).toBe(false);
  });

  it('degrades an unreadable (EPERM-style) storage.json into a registry-wide warning and suppresses orphans without rejecting', async () => {
    // Mirrors the corrupt-JSON case, but exercises the IO-error path: readFile itself failed
    // (e.g. a locked file), not JSON.parse. Unreadable must degrade exactly like unparsable —
    // never conflated with "missing", which would silently skip orphan suppression instead.
    const unreadable = Object.assign(new Error(`EPERM: operation not permitted, open '${PATHS.storageJson}'`), {
      code: 'EPERM',
    });
    const io = makeIo(
      { [PATHS.storageJson]: unreadable, [PATHS.globalExtensionsJson]: defaultManifest },
      ['pub.alpha-1.0.0', 'pub.hidden-4.0.0'],
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    expect(inv.profiles.map((p) => p.id)).toEqual(['default']);
    expect(inv.warnings).toHaveLength(1);
    expect(inv.warnings[0]?.file).toBe('globalStorage/storage.json');
    expect(inv.warnings[0]?.message).toBe(unreadable.message);
    expect(inv.warnings[0]?.affectedProfileIds).toEqual(['default']);
    // Named profiles are invisible without the registry, so pub.hidden looks disk-only —
    // suppress orphan reporting rather than guess, same as the corrupt-JSON case.
    expect(inv.extensions.find((e) => e.id === 'pub.hidden')).toBeUndefined();
    expect(inv.extensions.some((e) => e.orphaned)).toBe(false);
  });

  it('degrades an unreadable extensions folder into a warning instead of treating it as empty', async () => {
    const unreadable = Object.assign(new Error("EACCES: permission denied, scandir '/ext'"), { code: 'EACCES' });
    const io = makeIo(
      { [PATHS.storageJson]: storageJson, [PATHS.globalExtensionsJson]: defaultManifest },
      unreadable,
    );
    const inv = await new InventoryService(PATHS, io).getInventory();
    const warning = inv.warnings.find((w) => w.file === 'extensions/');
    expect(warning?.message).toBe(unreadable.message);
    expect(warning?.affectedProfileIds).toEqual([]);
    expect(inv.extensions.find((e) => e.id === 'pub.alpha')?.versions).toEqual([]);
    expect(inv.extensions.some((e) => e.orphaned)).toBe(false);
  });

  it('reports an unreadable package.json as a warning instead of silently dropping its metadata', async () => {
    const broken = new Error('package.json: invalid JSON');
    const io: InventoryIo = {
      ...makeIo({ [PATHS.storageJson]: storageJson, [PATHS.globalExtensionsJson]: defaultManifest }),
      listDirs: () => Promise.resolve(['pub.alpha-1.0.0']),
      readPackageMeta: () => Promise.resolve(broken),
    };
    const inv = await new InventoryService(PATHS, io).getInventory();
    const warning = inv.warnings.find((w) => w.file === 'extensions/pub.alpha-1.0.0/package.json');
    expect(warning?.message).toBe(broken.message);
    expect(warning?.affectedProfileIds).toEqual([]);
    expect(inv.extensions.find((e) => e.id === 'pub.alpha')?.displayName).toBe('pub.alpha');
  });

  it('warns about a broken package.json even when an earlier version folder supplied every field', async () => {
    const broken = new Error('package.json: invalid JSON');
    const io: InventoryIo = {
      ...makeIo({ [PATHS.storageJson]: storageJson, [PATHS.globalExtensionsJson]: defaultManifest }),
      listDirs: () => Promise.resolve(['pub.alpha-1.0.0', 'pub.alpha-0.9.0']),
      readPackageMeta: (p) =>
        Promise.resolve(
          p.endsWith('pub.alpha-0.9.0')
            ? broken
            : { displayName: 'Alpha', icon: 'icon.png', description: 'Does alpha things.', publisher: 'pub' },
        ),
    };
    const inv = await new InventoryService(PATHS, io).getInventory();
    expect(inv.warnings.find((w) => w.file === 'extensions/pub.alpha-0.9.0/package.json')?.message).toBe(
      broken.message,
    );
    expect(inv.extensions.find((e) => e.id === 'pub.alpha')?.displayName).toBe('Alpha');
  });

  it('degrades a corrupt per-profile manifest into a warning for that profile without rejecting', async () => {
    const io = makeIo({
      [PATHS.storageJson]: storageJson,
      [PATHS.globalExtensionsJson]: defaultManifest,
      '/data/User/profiles/aaa/extensions.json': '{{{',
    });
    const inv = await new InventoryService(PATHS, io).getInventory();
    expect(inv.warnings).toHaveLength(1);
    expect(inv.warnings[0]?.file).toBe('profiles/aaa/extensions.json');
    expect(inv.warnings[0]?.affectedProfileIds).toEqual(['aaa']);
  });
});

describe('directInstallProfileIds', () => {
  it('excludes profiles that only inherit the extension from the default profile', () => {
    const inv = composeInventory(baseInput());
    // pub.default-only is installed in 'default' and inherited by 'builtin/agents' (inheriting).
    expect(directInstallProfileIds(inv, 'pub.default-only')).toEqual(['default']);
  });

  it('includes every non-inheriting profile the extension is directly installed in', () => {
    const inv = composeInventory({
      rawProfiles: [
        { location: 'p1', name: 'P1', inheritsDefaultExtensions: false },
        { location: 'p2', name: 'P2', inheritsDefaultExtensions: false },
      ] as RawProfile[],
      defaultManifest: [] as ManifestEntry[] | Error,
      profileManifests: new Map<string, ManifestEntry[] | Error>([
        ['p1', [entry('pub.shared', '1.0.0')]],
        ['p2', [entry('pub.shared', '1.0.0')]],
      ]),
      diskFolders: ['pub.shared-1.0.0'],
      obsoleteFolderNames: [] as string[],
      displayNames: new Map<string, string>(),
      extensionsDir: '/x',
      platform: 'linux',
    });
    expect(directInstallProfileIds(inv, 'pub.shared')).toEqual(['p1', 'p2']);
  });

  it('returns an empty array for an unknown extension id', () => {
    const inv = composeInventory(baseInput());
    expect(directInstallProfileIds(inv, 'pub.does-not-exist')).toEqual([]);
  });
});

describe('installInEveryProfileTargets', () => {
  it('targets non-inheriting profiles missing the extension, skipping inheriting and already-installed ones', () => {
    const inv = composeInventory(baseInput());
    // pub.default-only is installed in 'default' (direct) and 'builtin/agents' (inherited) —
    // only 'aaa' is a non-inheriting profile that still lacks it.
    expect(installInEveryProfileTargets(inv, 'pub.default-only').map((p) => p.id)).toEqual(['aaa']);
  });

  it('returns an empty array once installed (or inherited) in every profile', () => {
    const inv = composeInventory(baseInput());
    expect(installInEveryProfileTargets(inv, 'pub.everywhere')).toEqual([]);
  });

  it('excludes profiles disabled by a parse warning even when they lack the extension', () => {
    const input = baseInput();
    input.profileManifests.set('aaa', new Error('boom'));
    const inv = composeInventory(input);
    expect(installInEveryProfileTargets(inv, 'pub.default-only')).toEqual([]);
  });

  it('returns an empty array for an unknown extension id', () => {
    const inv = composeInventory(baseInput());
    expect(installInEveryProfileTargets(inv, 'pub.does-not-exist')).toEqual([]);
  });

  it('never targets an extension applied to all profiles, even if a profile were missing from installedIn', () => {
    // Regression: ids applied to all profiles must be excluded by the applyToAllProfiles flag itself, not
    // merely because composeInventory happens to fill installedIn — a hand-built record with a
    // gap in installedIn must still yield no targets.
    const inv: Inventory = {
      profiles: [
        { id: 'default', name: 'Default', isDefault: true, inheritsDefaultExtensions: false },
        { id: 'p1', name: 'P1', isDefault: false, inheritsDefaultExtensions: false },
      ],
      extensions: [
        {
          id: 'pub.applied-to-all',
          displayName: 'Applied To All',
          versions: [],
          applyToAllProfiles: true,
          installedIn: ['default'], // p1 missing — must still not be targeted
          orphaned: false,
        },
      ],
      warnings: [],
    };
    expect(installInEveryProfileTargets(inv, 'pub.applied-to-all')).toEqual([]);
  });
});

describe('removeFromEveryProfileTargets', () => {
  it('targets every profile the extension is directly installed in', () => {
    const inv = composeInventory(baseInput());
    expect(removeFromEveryProfileTargets(inv, 'pub.work-only').map((p) => p.id)).toEqual(['aaa']);
  });

  it('returns an empty array when not directly installed anywhere', () => {
    const inv = composeInventory(baseInput());
    expect(removeFromEveryProfileTargets(inv, 'pub.orphan')).toEqual([]);
  });

  it('excludes profiles disabled by a parse warning from the target list', () => {
    const inv: Inventory = {
      profiles: [
        { id: 'default', name: 'Default', isDefault: true, inheritsDefaultExtensions: false },
        { id: 'p1', name: 'P1', isDefault: false, inheritsDefaultExtensions: false },
        { id: 'p2', name: 'P2', isDefault: false, inheritsDefaultExtensions: false },
      ],
      extensions: [
        {
          id: 'pub.shared',
          displayName: 'Shared',
          versions: [],
          applyToAllProfiles: false,
          installedIn: ['p1', 'p2'],
          orphaned: false,
        },
      ],
      warnings: [{ file: 'profiles/p2/extensions.json', message: 'bad', affectedProfileIds: ['p2'] }],
    };
    expect(removeFromEveryProfileTargets(inv, 'pub.shared').map((p) => p.id)).toEqual(['p1']);
  });

  it('never targets an extension applied to all profiles despite installedIn covering every profile', () => {
    // Regression: composeInventory propagates applied-to-all-profiles ids into every profile's installedIn,
    // so directInstallProfileIds alone would report phantom per-profile installs (pub.everywhere
    // → default, aaa) — the applyToAllProfiles flag must short-circuit to no targets.
    const inv = composeInventory(baseInput());
    expect(directInstallProfileIds(inv, 'pub.everywhere')).toEqual(['default', 'aaa']); // the trap
    expect(removeFromEveryProfileTargets(inv, 'pub.everywhere')).toEqual([]);
  });
});

describe('profileExtensionCounts', () => {
  it('splits each profile into direct, from-Default, and applied-to-all-profiles counts', () => {
    const inv = composeInventory(baseInput());
    const counts = profileExtensionCounts(inv);
    // default: pub.default-only is its own manifest entry; pub.everywhere is applied to all profiles.
    expect(counts.get('default')).toEqual({ direct: 1, fromDefault: 0, appliedToAllProfiles: 1 });
    // aaa: pub.work-only is its own manifest entry; pub.everywhere is applied to all profiles.
    expect(counts.get('aaa')).toEqual({ direct: 1, fromDefault: 0, appliedToAllProfiles: 1 });
    // builtin/agents uses the default profile's extensions: no manifest of its own, so its
    // pub.default-only comes from Default, counted apart from pub.everywhere.
    expect(counts.get('builtin/agents')).toEqual({ direct: 0, fromDefault: 1, appliedToAllProfiles: 1 });
  });

  it("zeroes an inheriting profile's direct count even though composeInventory propagates default extensions into its installedIn", () => {
    const inv = composeInventory(baseInput());
    const defOnly = inv.extensions.find((e) => e.id === 'pub.default-only');
    expect(defOnly?.installedIn).toContain('builtin/agents'); // the trap: it *is* in installedIn
    expect(profileExtensionCounts(inv).get('builtin/agents')?.direct).toBe(0);
  });

  it("drops a warned profile's direct count to 0 without affecting other profiles' counts", () => {
    const input = baseInput();
    input.profileManifests.set('aaa', new Error('boom'));
    const inv = composeInventory(input);
    const counts = profileExtensionCounts(inv);
    expect(counts.get('aaa')).toEqual({ direct: 0, fromDefault: 0, appliedToAllProfiles: 1 });
    expect(counts.get('default')).toEqual({ direct: 1, fromDefault: 0, appliedToAllProfiles: 1 });
    expect(counts.get('builtin/agents')).toEqual({ direct: 0, fromDefault: 1, appliedToAllProfiles: 1 });
  });

  it('returns all-zero counts when no extension is installed anywhere', () => {
    const inv = composeInventory({
      rawProfiles: [{ location: 'p1', name: 'P1', inheritsDefaultExtensions: false }] as RawProfile[],
      defaultManifest: [] as ManifestEntry[] | Error,
      profileManifests: new Map<string, ManifestEntry[] | Error>(),
      diskFolders: [] as string[],
      obsoleteFolderNames: [] as string[],
      displayNames: new Map<string, string>(),
      extensionsDir: '/x',
      platform: 'linux',
    });
    const zero = { direct: 0, fromDefault: 0, appliedToAllProfiles: 0 };
    expect(profileExtensionCounts(inv).get('p1')).toEqual(zero);
    expect(profileExtensionCounts(inv).get('default')).toEqual(zero);
  });
});

describe('profileManifestPath', () => {
  const paths: ResolvedPaths = {
    userDataDir: '/data',
    userDir: '/data/User',
    storageJson: '/data/User/globalStorage/storage.json',
    profilesDir: '/data/User/profiles',
    extensionsDir: '/ext',
    globalExtensionsJson: '/ext/extensions.json',
    obsoleteFile: '/ext/.obsolete',
    platform: 'linux',
  };

  it('resolves the default profile to the global extensions.json', () => {
    const p: Profile = { id: 'default', name: 'Default', isDefault: true, inheritsDefaultExtensions: false };
    expect(profileManifestPath(paths, p)).toBe('/ext/extensions.json');
  });

  it('resolves a named, non-inheriting profile to <profilesDir>/<id>/extensions.json', () => {
    const p: Profile = { id: 'aaa', name: 'Work', isDefault: false, inheritsDefaultExtensions: false };
    expect(profileManifestPath(paths, p)).toBe('/data/User/profiles/aaa/extensions.json');
  });

  it("returns undefined for a profile that inherits the default profile's extensions — it has no file of its own", () => {
    const p: Profile = { id: 'builtin/agents', name: 'Agents', isDefault: false, inheritsDefaultExtensions: true };
    expect(profileManifestPath(paths, p)).toBeUndefined();
  });

  it('joins with the platform separator', () => {
    const winPaths: ResolvedPaths = { ...paths, profilesDir: 'C:\\Users\\me\\profiles', platform: 'win32' };
    const p: Profile = { id: 'aaa', name: 'Work', isDefault: false, inheritsDefaultExtensions: false };
    expect(profileManifestPath(winPaths, p)).toBe('C:\\Users\\me\\profiles\\aaa\\extensions.json');
  });
});
