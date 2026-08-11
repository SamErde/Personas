import { describe, expect, it } from 'vitest';
import type {
  Inventory,
  Profile,
  WorkspaceDescriptor,
  WorkspaceExtensionStatus,
  WorkspaceInventory,
} from '../../src/core/types';
import type { ParsedWorkspaceProfileAssociations } from '../../src/core/parsers';
import {
  WorkspaceInventoryService,
  composeWorkspaceInventory,
  createWorkspaceDescriptor,
  discoverWorkspaceLocalExtensions,
  isFsPathContained,
  normalizeUriIdentity,
  resolveActiveProfile,
  workspaceExtensionCounts,
  workspaceExtensionsRootPaths,
  workspaceWatchTargets,
  type WorkspaceDiscoveryResult,
  type WorkspaceRuntimeExtension,
} from '../../src/core/workspace';

const profiles: Profile[] = [
  { id: 'default', name: 'Default', isDefault: true, inheritsDefaultExtensions: false },
  { id: 'abc123', name: 'Work', isDefault: false, inheritsDefaultExtensions: false },
  { id: 'builtin/agents', name: 'Agents', isDefault: false, inheritsDefaultExtensions: true },
];

const descriptor: WorkspaceDescriptor = {
  name: 'Example',
  kind: 'folder',
  associationUri: 'file:///c%3A/Code/Example',
  rootFsPaths: ['C:\\Code\\Example'],
};

const association = (profileId = 'abc123'): ParsedWorkspaceProfileAssociations => ({
  workspaces: new Map([[descriptor.associationUri as string, profileId]]),
  warnings: [],
  present: true,
});

const inventory = (options?: {
  installedIn?: string[];
  warnings?: Inventory['warnings'];
  id?: string;
}): Inventory => ({
  profiles,
  extensions: [
    {
      id: options?.id ?? 'pub.ext',
      displayName: 'Example extension',
      versions: [
        {
          version: '1.2.3',
          folderName: 'pub.ext-1.2.3',
          fsPath: 'C:\\sandbox\\extensions\\pub.ext-1.2.3',
        },
      ],
      applyToAllProfiles: false,
      installedIn: options?.installedIn ?? ['abc123'],
      orphaned: false,
      description: 'Example description',
      publisher: 'pub',
    },
  ],
  warnings: options?.warnings ?? [],
});

const discovery = (candidates: WorkspaceDiscoveryResult['candidates'] = []): WorkspaceDiscoveryResult => ({
  candidates,
  warnings: [],
});

const runtime = (
  fsPath = 'C:\\sandbox\\extensions\\pub.ext-1.2.3',
  id = 'pub.ext',
): WorkspaceRuntimeExtension => ({
  id,
  uri: `file:///${fsPath.replaceAll('\\', '/')}`,
  fsPath,
});

function compose(options?: {
  inv?: Inventory;
  associations?: ParsedWorkspaceProfileAssociations | Error;
  candidates?: WorkspaceDiscoveryResult['candidates'];
  runtimes?: WorkspaceRuntimeExtension[] | Error;
}): WorkspaceInventory {
  return composeWorkspaceInventory({
    descriptor,
    inventory: options?.inv ?? inventory(),
    associations: options?.associations ?? association(),
    discovery: discovery(options?.candidates),
    runtimeExtensions: options?.runtimes ?? [],
  });
}

describe('createWorkspaceDescriptor', () => {
  it('omits the workspace in an empty window', () => {
    expect(createWorkspaceDescriptor({ folders: [] })).toBeUndefined();
  });

  it('uses the only folder URI, name, and local root for a folder workspace', () => {
    expect(
      createWorkspaceDescriptor({
        folders: [
          {
            name: 'Folder A',
            uri: 'file:///c%3A/code/folder-a',
            scheme: 'file',
            fsPath: 'C:\\code\\folder-a',
          },
        ],
      }),
    ).toEqual({
      name: 'Folder A',
      kind: 'folder',
      associationUri: 'file:///c%3A/code/folder-a',
      rootFsPaths: ['C:\\code\\folder-a'],
    });
  });

  it('uses one saved workspace identity and exposes its local JSON manifest', () => {
    expect(
      createWorkspaceDescriptor({
        name: 'Shared setup',
        workspaceFileUri: 'file:///c%3A/code/shared.code-workspace',
        workspaceFileFsPath: 'C:\\code\\shared.code-workspace',
        folders: [
          { name: 'A', uri: 'file:///c%3A/code/a', scheme: 'file', fsPath: 'C:\\code\\a' },
          { name: 'Remote', uri: 'vscode-remote://ssh-remote+x/home/me/b', scheme: 'vscode-remote' },
        ],
      }),
    ).toEqual({
      name: 'Shared setup',
      kind: 'workspace',
      associationUri: 'file:///c%3A/code/shared.code-workspace',
      manifestFsPath: 'C:\\code\\shared.code-workspace',
      rootFsPaths: ['C:\\code\\a'],
    });
  });

  it('does not expose a manifest action for an untitled or non-.code-workspace identity', () => {
    expect(
      createWorkspaceDescriptor({
        workspaceFileUri: 'untitled:Untitled-1',
        workspaceFileFsPath: 'C:\\temp\\untitled.code-workspace',
        folders: [],
      }),
    ).toEqual({
      name: 'Untitled-1',
      kind: 'workspace',
      associationUri: 'untitled:Untitled-1',
      rootFsPaths: [],
    });
  });

  it('keeps a non-file folder visible but excludes it from local discovery roots', () => {
    expect(
      createWorkspaceDescriptor({
        folders: [{ name: 'Remote', uri: 'vscode-remote://ssh-remote+x/home/me/repo', scheme: 'vscode-remote' }],
      }),
    ).toEqual({
      name: 'Remote',
      kind: 'folder',
      associationUri: 'vscode-remote://ssh-remote+x/home/me/repo',
      rootFsPaths: [],
    });
  });
});

describe('workspace URI and profile identity', () => {
  it('normalizes Windows drive-letter case and colon/space escaping', () => {
    expect(normalizeUriIdentity('FILE:///C%3A/Code/My%20Repo/')).toBe(
      normalizeUriIdentity('file:///c:/code/my repo'),
    );
  });

  it('preserves POSIX path case', () => {
    expect(normalizeUriIdentity('file:///home/Sam/Repo')).not.toBe(
      normalizeUriIdentity('file:///home/sam/repo'),
    );
  });

  it('returns undefined for malformed identities', () => {
    expect(normalizeUriIdentity('not a uri')).toBeUndefined();
  });

  it('resolves the default sentinel and named profile ids', () => {
    expect(resolveActiveProfile(descriptor, association('__default__profile__'), profiles).profile?.id).toBe(
      'default',
    );
    expect(resolveActiveProfile(descriptor, association('abc123'), profiles).profile?.name).toBe('Work');
  });

  it('resolves a unique registry-location basename such as the implicit Agents profile', () => {
    expect(resolveActiveProfile(descriptor, association('agents'), profiles).profile?.id).toBe(
      'builtin/agents',
    );
  });

  it('matches an escaped, differently cased Windows URI exactly after normalization', () => {
    const associations: ParsedWorkspaceProfileAssociations = {
      workspaces: new Map([['file:///C:/code/example/', 'abc123']]),
      warnings: [],
      present: true,
    };
    expect(resolveActiveProfile(descriptor, associations, profiles).profile?.id).toBe('abc123');
  });

  it.each([
    ['missing association', { workspaces: new Map(), warnings: [], present: false }],
    ['unknown profile', association('does-not-exist')],
  ] satisfies [string, ParsedWorkspaceProfileAssociations][])('%s remains unresolved', (_name, associations) => {
    const result = resolveActiveProfile(descriptor, associations, profiles);
    expect(result.profile).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects conflicting keys that normalize to the same workspace URI', () => {
    const result = resolveActiveProfile(
      descriptor,
      {
        workspaces: new Map([
          ['file:///C:/Code/Example', 'abc123'],
          ['file:///c%3A/code/example/', '__default__profile__'],
        ]),
        warnings: [],
        present: true,
      },
      profiles,
    );
    expect(result.profile).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('Conflicting');
  });

  it('keeps parser warnings and rejects malformed descriptor identities', () => {
    const result = resolveActiveProfile(
      { ...descriptor, associationUri: 'not a URI' },
      { workspaces: new Map(), warnings: ['bad entry'], present: true },
      profiles,
    );
    expect(result.profile).toBeUndefined();
    expect(result.warnings).toContain('bad entry');
    expect(result.warnings.join(' ')).toContain('malformed');
  });
});

describe('workspace-local candidate discovery', () => {
  it('scans only immediate child directories and normalizes valid manifest metadata', async () => {
    const root = 'C:\\Code\\Example\\.vscode\\extensions';
    const result = await discoverWorkspaceLocalExtensions(descriptor, {
      listEntries: async (requested) => {
        expect(requested).toBe(root);
        return [
          { name: 'Local-One', isDirectory: true },
          { name: '..\\escape', isDirectory: true },
          { name: 'not-a-directory', isDirectory: false },
        ];
      },
      readFile: async (requested) => {
        expect(requested).toBe(`${root}\\Local-One\\package.json`);
        return JSON.stringify({
          publisher: 'Acme',
          name: 'Widget',
          displayName: 'Workspace Widget',
          version: '1.0.0',
          description: 'Local fixture',
        });
      },
    });
    expect(result.candidates).toEqual([
      {
        id: 'acme.widget',
        displayName: 'Workspace Widget',
        version: '1.0.0',
        description: 'Local fixture',
        publisher: 'Acme',
        fsPath: `${root}\\Local-One`,
        runtimeVisible: false,
      },
    ]);
    expect(result.warnings.join(' ')).toContain('unsafe');
    expect(result.warnings.join(' ')).toContain('non-directory');
  });

  it('reports unreadable roots, missing/invalid manifests, and invalid extension ids without throwing', async () => {
    const rootsDescriptor = { ...descriptor, rootFsPaths: ['C:\\A', 'C:\\B'] };
    const result = await discoverWorkspaceLocalExtensions(rootsDescriptor, {
      listEntries: async (requested) =>
        requested.startsWith('C:\\A')
          ? new Error('access denied')
          : ['missing', 'json', 'bad-id'].map((name) => ({ name, isDirectory: true })),
      readFile: async (requested) => {
        if (requested.includes('missing')) return undefined;
        if (requested.includes('json')) return '{nope';
        return JSON.stringify({ publisher: '../bad', name: 'name' });
      },
    });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toHaveLength(4);
  });

  it('keeps duplicate candidates deterministic and emits one duplicate warning', async () => {
    const rootsDescriptor = { ...descriptor, rootFsPaths: ['C:\\Z', 'C:\\A'] };
    const result = await discoverWorkspaceLocalExtensions(rootsDescriptor, {
      listEntries: async () => [{ name: 'fixture', isDirectory: true }],
      readFile: async () => JSON.stringify({ publisher: 'Pub', name: 'Duplicate' }),
    });
    expect(result.candidates.map((candidate) => candidate.fsPath)).toEqual([
      'C:\\A\\.vscode\\extensions\\fixture',
      'C:\\Z\\.vscode\\extensions\\fixture',
    ]);
    expect(result.warnings).toEqual([
      'Multiple workspace roots contain local extension pub.duplicate; the effective runtime location wins.',
    ]);
  });

  it('uses boundary-aware, platform-aware path containment', () => {
    expect(isFsPathContained('C:\\Repo\\.vscode\\extensions\\one', 'c:\\repo\\.vscode\\extensions\\one\\dist')).toBe(
      true,
    );
    expect(isFsPathContained('C:\\Repo\\one', 'C:\\Repo\\one-other')).toBe(false);
    expect(isFsPathContained('/repo/One', '/repo/one/file')).toBe(false);
  });

  it('returns only the bounded candidate roots that should be watched', () => {
    expect(workspaceExtensionsRootPaths({ ...descriptor, rootFsPaths: ['C:\\B', '/a'] })).toEqual([
      'C:\\B\\.vscode\\extensions',
      '/a/.vscode/extensions',
    ]);
  });

  it('builds narrow patterns that catch candidate-root creation and saved-manifest changes', () => {
    expect(
      workspaceWatchTargets({
        ...descriptor,
        manifestFsPath: 'C:\\Code\\Example\\shared.code-workspace',
      }),
    ).toEqual([
      { baseFsPath: 'C:\\Code\\Example', pattern: '.vscode/extensions/**' },
      { baseFsPath: 'C:\\Code\\Example', pattern: 'shared.code-workspace' },
    ]);
  });
});

describe('workspace status composition', () => {
  it.each([
    {
      name: 'runtime-visible profile extension',
      options: { runtimes: [runtime()] },
      expectedState: 'enabled',
      expectedMembership: true,
    },
    {
      name: 'installed profile extension absent from the supported snapshot',
      options: {},
      expectedState: 'notEnabled',
      expectedMembership: true,
    },
    {
      name: 'extension not installed in the known active profile',
      options: { inv: inventory({ installedIn: ['default'] }) },
      expectedState: 'notInstalledInProfile',
      expectedMembership: false,
    },
    {
      name: 'unresolved active profile',
      options: { associations: { workspaces: new Map(), warnings: [], present: false } },
      expectedState: 'unknown',
      expectedMembership: 'unknown',
    },
    {
      name: 'unreadable effective extension snapshot',
      options: { runtimes: new Error('snapshot failed') },
      expectedState: 'unknown',
      expectedMembership: true,
    },
    {
      name: 'unreadable active-profile manifest',
      options: {
        inv: inventory({
          warnings: [{ file: 'profiles/abc123/extensions.json', message: 'bad JSON', affectedProfileIds: ['abc123'] }],
        }),
      },
      expectedState: 'unknown',
      expectedMembership: 'unknown',
    },
  ] satisfies {
    name: string;
    options: Parameters<typeof compose>[0];
    expectedState: WorkspaceExtensionStatus['state'];
    expectedMembership: boolean | 'unknown';
  }[])('$name', ({ options, expectedState, expectedMembership }) => {
    const status = compose(options).extensions[0];
    expect(status?.state).toBe(expectedState);
    expect(status?.installedInActiveProfile).toBe(expectedMembership);
  });

  it('keeps a non-visible local manifest as a candidate with Unknown status', () => {
    const candidate = {
      id: 'local.only',
      displayName: 'Local only',
      fsPath: 'C:\\Code\\Example\\.vscode\\extensions\\local-only',
      runtimeVisible: false,
    };
    const result = compose({ inv: { ...inventory(), extensions: [] }, candidates: [candidate] });
    expect(result.extensions[0]).toMatchObject({
      id: 'local.only',
      state: 'unknown',
      workspaceLocal: 'candidate',
      runtimeSource: 'unknown',
      profileBacked: false,
    });
    expect(result.localExtensions[0]?.runtimeVisible).toBe(false);
  });

  it('positively identifies a workspace-local extension only by a contained runtime URI', () => {
    const candidatePath = 'C:\\Code\\Example\\.vscode\\extensions\\local-only';
    const candidate = {
      id: 'local.only',
      displayName: 'Local only',
      fsPath: candidatePath,
      runtimeVisible: false,
    };
    const result = compose({
      inv: { ...inventory(), extensions: [] },
      candidates: [candidate],
      runtimes: [runtime(`${candidatePath}\\dist`, 'LOCAL.ONLY')],
    });
    expect(result.extensions[0]).toMatchObject({
      state: 'enabled',
      installedInActiveProfile: false,
      workspaceLocal: 'installed',
      runtimeSource: 'workspace',
      runtimeUri: expect.any(String),
    });
    expect(result.localExtensions[0]?.runtimeVisible).toBe(true);
  });

  it('reports both sources when the effective workspace-local copy is also profile-installed', () => {
    const candidatePath = 'C:\\Code\\Example\\.vscode\\extensions\\pub-ext';
    const result = compose({
      candidates: [
        {
          id: 'pub.ext',
          displayName: 'Workspace copy',
          fsPath: candidatePath,
          runtimeVisible: false,
        },
      ],
      runtimes: [runtime(candidatePath)],
    });
    expect(result.extensions[0]).toMatchObject({
      state: 'enabled',
      installedInActiveProfile: true,
      workspaceLocal: 'installed',
      runtimeSource: 'workspace',
    });
    expect(result.extensions[0]?.reason).toContain('also installed in the active profile');
    expect(result.extensions[0]?.reason).toContain(candidatePath);
  });

  it('preserves inherited and application-scoped membership already composed by profile inventory', () => {
    const inherited = compose({
      inv: inventory({ installedIn: ['default', 'builtin/agents'] }),
      associations: association('agents'),
    }).extensions[0];
    expect(inherited).toMatchObject({ state: 'notEnabled', installedInActiveProfile: true });

    const appScopedInventory = inventory({ installedIn: profiles.map((profile) => profile.id) });
    if (appScopedInventory.extensions[0]) appScopedInventory.extensions[0].applyToAllProfiles = true;
    const appScoped = compose({ inv: appScopedInventory }).extensions[0];
    expect(appScoped).toMatchObject({ state: 'notEnabled', installedInActiveProfile: true });
  });

  it('does not confuse a same-id runtime outside the candidate with a workspace-local install', () => {
    const candidate = {
      id: 'pub.ext',
      displayName: 'Candidate',
      fsPath: 'C:\\Code\\Example\\.vscode\\extensions\\candidate',
      runtimeVisible: false,
    };
    const status = compose({ candidates: [candidate], runtimes: [runtime()] }).extensions[0];
    expect(status).toMatchObject({ state: 'enabled', workspaceLocal: 'candidate', runtimeSource: 'profile' });
  });

  it('warns but stays deterministic when VS Code reports duplicate effective locations', () => {
    const result = compose({ runtimes: [runtime('C:\\one'), runtime('C:\\two')] });
    expect(result.warnings.join(' ')).toContain('multiple effective locations');
    expect(result.extensions[0]?.runtimeUri).toContain('C:/one');
  });
});

describe('workspace activity counts and service failures', () => {
  it('counts only active-profile or local records and separately counts installed local copies', () => {
    const baseStatus = {
      displayName: 'x',
      profileBacked: true,
      runtimeSource: 'profile' as const,
      reason: 'reason',
    };
    const statuses: WorkspaceExtensionStatus[] = [
      { ...baseStatus, id: 'a', state: 'enabled', installedInActiveProfile: true, workspaceLocal: 'none' },
      { ...baseStatus, id: 'b', state: 'notEnabled', installedInActiveProfile: true, workspaceLocal: 'none' },
      { ...baseStatus, id: 'c', state: 'unknown', installedInActiveProfile: 'unknown', workspaceLocal: 'candidate' },
      { ...baseStatus, id: 'd', state: 'enabled', installedInActiveProfile: false, workspaceLocal: 'installed' },
      {
        ...baseStatus,
        id: 'e',
        state: 'notInstalledInProfile',
        installedInActiveProfile: false,
        workspaceLocal: 'none',
      },
    ];
    expect(
      workspaceExtensionCounts({
        descriptor,
        activeProfileId: 'abc123',
        activeProfileName: 'Work',
        extensions: statuses,
        localExtensions: [],
        warnings: [],
      }),
    ).toEqual({ enabled: 2, notEnabled: 1, unknown: 1, workspaceLocal: 1 });
  });

  it('returns no workspace without touching injected storage or runtime sources', async () => {
    let touched = false;
    const service = new WorkspaceInventoryService('storage.json', {
      getDescriptor: () => undefined,
      getRuntimeExtensions: () => {
        touched = true;
        return [];
      },
      listEntries: async () => {
        touched = true;
        return [];
      },
      readFile: async () => {
        touched = true;
        return undefined;
      },
    });
    expect(await service.getWorkspaceInventory(inventory())).toBeUndefined();
    expect(service.watchedTargets()).toEqual([]);
    expect(touched).toBe(false);
  });

  it('turns missing association storage and thrown runtime reads into visible Unknown evidence', async () => {
    const service = new WorkspaceInventoryService('storage.json', {
      getDescriptor: () => descriptor,
      getRuntimeExtensions: () => {
        throw new Error('host unavailable');
      },
      listEntries: async () => [],
      readFile: async () => undefined,
    });
    const result = await service.getWorkspaceInventory(inventory());
    expect(result?.extensions[0]?.state).toBe('unknown');
    expect(result?.warnings.join(' ')).toContain('storage.json is missing');
    expect(result?.warnings.join(' ')).toContain('host unavailable');
    expect(service.watchedTargets()).toEqual([
      { baseFsPath: 'C:\\Code\\Example', pattern: '.vscode/extensions/**' },
    ]);
  });
});
