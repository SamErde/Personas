import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ParseError,
  parseExtensionFolderName,
  parseExtensionsManifest,
  parseObsolete,
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
      present: false,
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
    expect(parsed.present).toBe(true);
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
      present: false,
      warnings: ['profileAssociations is not an object.'],
    });
    expect(
      parseWorkspaceProfileAssociations('{"profileAssociations": {"workspaces": []}}'),
    ).toMatchObject({
      present: false,
      warnings: ['profileAssociations.workspaces is not an object.'],
    });
  });

  it('preserves the normal storage.json parse error contract', () => {
    expect(() => parseWorkspaceProfileAssociations('{nope')).toThrow(ParseError);
    expect(() => parseWorkspaceProfileAssociations('null')).toThrow(ParseError);
  });
});

describe('parseExtensionsManifest', () => {
  it('extracts id (lowercased), version, relativeLocation, app scope, and metadata extras', () => {
    const entries = parseExtensionsManifest(fixture('extensions-global.json'));
    expect(entries).toEqual([
      {
        id: 'johnpapa.vscode-peacock',
        version: '4.2.2',
        relativeLocation: 'johnpapa.vscode-peacock-4.2.2',
        isApplicationScoped: true,
        publisherDisplayName: 'John Papa',
        installedTimestamp: 1771712605225,
      },
      {
        id: 'esbenp.prettier-vscode',
        version: '11.0.0',
        relativeLocation: 'esbenp.prettier-vscode-11.0.0',
        isApplicationScoped: false,
        installedTimestamp: 1771712605000,
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
      isApplicationScoped: false,
    });
    expect(onlyEntry).not.toHaveProperty('publisherDisplayName');
    expect(onlyEntry).not.toHaveProperty('installedTimestamp');
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
