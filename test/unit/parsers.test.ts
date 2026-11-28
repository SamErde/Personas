import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ParseError,
  parseExtensionFolderName,
  parseExtensionsManifest,
  parseObsolete,
  parsePackageMeta,
  parseProfileRegistry,
  parseWorkspaceProfileAssociations,
} from '../../src/core/parsers';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');

describe('parseProfileRegistry', () => {
  it('extracts profiles with inheritance flag', () => {
    const profiles = parseProfileRegistry(fixture('storage.json'));
    expect(profiles).toEqual([
      { location: '4328b3eb', name: 'Blog', inheritsDefaultExtensions: false },
      { location: '7cdc4d19', name: 'Work', inheritsDefaultExtensions: false },
      { location: 'builtin/agents', name: 'Agents', inheritsDefaultExtensions: true },
    ]);
  });

  it('returns [] when userDataProfiles is absent', () => {
    expect(parseProfileRegistry('{"other": 1}')).toEqual([]);
  });

  it('throws ParseError on malformed JSON', () => {
    expect(() => parseProfileRegistry('{nope')).toThrow(ParseError);
  });

  it('skips malformed entries instead of throwing', () => {
    const text = '{"userDataProfiles": [{"name": "NoLocation"}, {"location": "ab", "name": "OK"}]}';
    expect(parseProfileRegistry(text)).toEqual([{ location: 'ab', name: 'OK', inheritsDefaultExtensions: false }]);
  });
});

describe('parseWorkspaceProfileAssociations', () => {
  it('returns an absent, empty map when profile associations are missing', () => {
    expect(parseWorkspaceProfileAssociations('{"other": 1}')).toEqual({
      workspaces: new Map(),
      warnings: [],
    });
  });

  it('extracts valid workspace associations without depending on unrelated keys', () => {
    const parsed = parseWorkspaceProfileAssociations(
      JSON.stringify({
        unrelated: true,
        profileAssociations: {
          workspaces: {
            'file:///c%3A/code/one': '__default__profile__',
            'file:///c%3A/code/two.code-workspace': 'profile-id',
          },
          emptyWindows: { window: 'ignored' },
        },
      }),
    );
    expect([...parsed.workspaces]).toEqual([
      ['file:///c%3A/code/one', '__default__profile__'],
      ['file:///c%3A/code/two.code-workspace', 'profile-id'],
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it('ignores malformed entries individually and reports them', () => {
    const parsed = parseWorkspaceProfileAssociations(
      JSON.stringify({
        profileAssociations: {
          workspaces: {
            '': 'profile-id',
            '   ': 'profile-id',
            'file:///valid': '__default__profile__',
            'file:///number': 42,
            'file:///blank': '   ',
          },
        },
      }),
    );
    expect([...parsed.workspaces]).toEqual([['file:///valid', '__default__profile__']]);
    expect(parsed.warnings).toHaveLength(4);
    expect(parsed.warnings.filter((warning) => warning.endsWith('for <empty key>.'))).toHaveLength(2);
  });

  it('fails closed when the associations container or workspace map has the wrong shape', () => {
    expect(parseWorkspaceProfileAssociations('{"profileAssociations": []}')).toMatchObject({
      warnings: ['profileAssociations is not an object.'],
    });
    expect(
      parseWorkspaceProfileAssociations('{"profileAssociations": {"workspaces": []}}'),
    ).toMatchObject({
      warnings: ['profileAssociations.workspaces is not an object.'],
    });
  });

  it('preserves the normal storage.json parse error contract', () => {
    expect(() => parseWorkspaceProfileAssociations('{nope')).toThrow(ParseError);
    expect(() => parseWorkspaceProfileAssociations('null')).toThrow(ParseError);
  });
});

describe('parseExtensionsManifest', () => {
  it('extracts id (lowercased), version, app scope, and metadata extras', () => {
    const entries = parseExtensionsManifest(fixture('extensions-global.json'));
    expect(entries).toEqual([
      {
        id: 'johnpapa.vscode-peacock',
        version: '4.2.2',
        relativeLocation: 'johnpapa.vscode-peacock-4.2.2',
        applyToAllProfiles: true,
        publisherDisplayName: 'John Papa',
        installedTimestamp: 1771712605225,
        source: 'gallery',
      },
      {
        id: 'esbenp.prettier-vscode',
        version: '11.0.0',
        relativeLocation: 'esbenp.prettier-vscode-11.0.0',
        applyToAllProfiles: false,
        installedTimestamp: 1771712605000,
        source: 'gallery',
      },
    ]);
  });

  it('lowercases mixed-case ids', () => {
    const text = '[{"identifier": {"id": "MS-Python.Python"}, "version": "1.0.0", "relativeLocation": "ms-python.python-1.0.0"}]';
    expect(parseExtensionsManifest(text)[0]?.id).toBe('ms-python.python');
  });

  it('throws ParseError on non-array JSON', () => {
    expect(() => parseExtensionsManifest('{"a":1}')).toThrow(ParseError);
  });

  it('omits publisherDisplayName/installedTimestamp when metadata is absent', () => {
    const text = '[{"identifier": {"id": "pub.ext"}, "version": "1.0.0", "relativeLocation": "pub.ext-1.0.0"}]';
    const [onlyEntry] = parseExtensionsManifest(text);
    expect(onlyEntry).toEqual({
      id: 'pub.ext',
      version: '1.0.0',
      relativeLocation: 'pub.ext-1.0.0',
      applyToAllProfiles: false,
    });
    expect(onlyEntry).not.toHaveProperty('publisherDisplayName');
    expect(onlyEntry).not.toHaveProperty('installedTimestamp');
  });
});

describe('parseExtensionsManifest folder reference', () => {
  const manifest = (entries: unknown[]) => JSON.stringify(entries);

  it('keeps a platform-suffixed folder reference that the version alone cannot identify', () => {
    const [onlyEntry] = parseExtensionsManifest(
      manifest([
        {
          identifier: { id: 'ms-dotnettools.csharp' },
          version: '2.39.29',
          relativeLocation: 'ms-dotnettools.csharp-2.39.29-win32-x64',
        },
      ]),
    );
    expect(onlyEntry?.version).toBe('2.39.29');
    expect(onlyEntry?.relativeLocation).toBe('ms-dotnettools.csharp-2.39.29-win32-x64');
  });

  it('omits the folder reference when it is missing, empty, or not a string', () => {
    const entries = parseExtensionsManifest(
      manifest([
        { identifier: { id: 'pub.missing' }, version: '1.0.0' },
        { identifier: { id: 'pub.empty' }, version: '1.0.0', relativeLocation: '' },
        { identifier: { id: 'pub.number' }, version: '1.0.0', relativeLocation: 42 },
      ]),
    );
    expect(entries).toHaveLength(3);
    for (const e of entries) expect(e).not.toHaveProperty('relativeLocation');
  });
});

describe('parseExtensionsManifest install source', () => {
  it('keeps metadata.source as written, including values the parser does not recognize', () => {
    const entries = parseExtensionsManifest(
      JSON.stringify([
        { identifier: { id: 'pub.gallery' }, version: '1.0.0', metadata: { source: 'gallery' } },
        { identifier: { id: 'pub.novel' }, version: '1.0.0', metadata: { source: 'something-new' } },
      ]),
    );
    expect(entries.map((e) => e.source)).toEqual(['gallery', 'something-new']);
  });

  it('omits the source when metadata is missing or the value is not a non-empty string', () => {
    const entries = parseExtensionsManifest(
      JSON.stringify([
        { identifier: { id: 'pub.no-metadata' }, version: '1.0.0' },
        { identifier: { id: 'pub.no-source' }, version: '1.0.0', metadata: {} },
        { identifier: { id: 'pub.empty' }, version: '1.0.0', metadata: { source: '' } },
        { identifier: { id: 'pub.number' }, version: '1.0.0', metadata: { source: 7 } },
      ]),
    );
    expect(entries).toHaveLength(4);
    for (const e of entries) expect(e).not.toHaveProperty('source');
  });
});

describe('parsePackageMeta display-name localization', () => {
  const pkg = (displayName: unknown) => JSON.stringify({ name: 'ext', displayName });

  it.each([
    ['%', '%', undefined],
    ['%%', undefined, ''],
    ['%key', '%key', undefined],
    ['key%', 'key%', undefined],
    ['%key%', undefined, 'key'],
    ['%key%tail%', undefined, 'key%tail'],
  ])('classifies %s with the same delimiter rule as VS Code', (value, displayName, displayNameKey) => {
    const meta = parsePackageMeta(pkg(value));
    expect(meta.displayName).toBe(displayName);
    expect(meta.displayNameKey).toBe(displayNameKey);
  });

  it.each([undefined, null, 42])('leaves a missing or non-string display name unresolved (%s)', (value) => {
    const meta = parsePackageMeta(value === undefined ? JSON.stringify({ name: 'ext' }) : pkg(value));
    expect(meta.displayName).toBeUndefined();
    expect(meta.displayNameKey).toBeUndefined();
  });

  it('keeps localized descriptions unresolved when display-name parsing changes', () => {
    const meta = parsePackageMeta(JSON.stringify({ name: 'ext', description: '%description%' }));
    expect(meta.description).toBeUndefined();
  });
});

describe('parsePackageMeta categories', () => {
  const pkg = (fields: Record<string, unknown>) => JSON.stringify({ name: 'ext', ...fields });

  it('reads the categories array', () => {
    expect(parsePackageMeta(pkg({ categories: ['Programming Languages', 'Linters'] })).categories).toEqual([
      'Programming Languages',
      'Linters',
    ]);
  });

  it('has no categories when the field is missing, not an array, or empty', () => {
    expect(parsePackageMeta(pkg({}))).not.toHaveProperty('categories');
    expect(parsePackageMeta(pkg({ categories: 'Linters' }))).not.toHaveProperty('categories');
    expect(parsePackageMeta(pkg({ categories: null }))).not.toHaveProperty('categories');
    expect(parsePackageMeta(pkg({ categories: [] }))).not.toHaveProperty('categories');
  });

  it('keeps the usable values of a partly malformed array and drops the rest', () => {
    expect(parsePackageMeta(pkg({ categories: ['Themes', 3, '', null, '  ', 'Themes', 'Other'] })).categories).toEqual([
      'Themes',
      'Other',
    ]);
    expect(parsePackageMeta(pkg({ categories: [1, false] }))).not.toHaveProperty('categories');
  });
});

describe('parsePackageMeta extension relationships', () => {
  it('reads, trims, and de-duplicates extension packs and dependencies', () => {
    const meta = parsePackageMeta(JSON.stringify({
      name: 'ext',
      extensionPack: ['pub.a', ' pub.b ', 'pub.a', 3],
      extensionDependencies: ['pub.c', '', null],
    }));
    expect(meta.extensionPack).toEqual(['pub.a', 'pub.b']);
    expect(meta.extensionDependencies).toEqual(['pub.c']);
  });

  it('omits unusable relationship fields', () => {
    expect(parsePackageMeta(JSON.stringify({ name: 'ext', extensionPack: 'pub.a' })))
      .not.toHaveProperty('extensionPack');
    expect(parsePackageMeta(JSON.stringify({ name: 'ext', extensionDependencies: [1, false] })))
      .not.toHaveProperty('extensionDependencies');
  });
});

describe('parseObsolete', () => {
  it('returns folder names flagged true', () => {
    expect(parseObsolete('{"pub.ext-1.0.0": true, "pub.other-2.0.0": false}')).toEqual(['pub.ext-1.0.0']);
  });
  it('returns [] for empty/whitespace text', () => {
    expect(parseObsolete('')).toEqual([]);
  });
});

describe('parseExtensionFolderName', () => {
  it('parses publisher.name-semver', () => {
    expect(parseExtensionFolderName('ms-python.python-2024.3.1')).toEqual({ id: 'ms-python.python', version: '2024.3.1' });
  });
  it('parses platform-suffixed folders', () => {
    expect(parseExtensionFolderName('ms-dotnettools.csharp-2.39.29-win32-x64')).toEqual({
      id: 'ms-dotnettools.csharp',
      version: '2.39.29-win32-x64',
    });
  });
  it('rejects non-extension folders', () => {
    expect(parseExtensionFolderName('.obsolete')).toBeUndefined();
    expect(parseExtensionFolderName('node_modules')).toBeUndefined();
  });
});
