import { describe, expect, it } from 'vitest';
import { MatrixActions } from '../../src/core/matrixActions';
import type { ExtensionRecord, Inventory, Profile } from '../../src/core/types';

const profile = (id: string, name: string, extra: Partial<Profile> = {}): Profile => ({
  id,
  name,
  isDefault: id === 'default',
  inheritsDefaultExtensions: false,
  ...extra,
});

const ext = (id: string, installedIn: string[], extra: Partial<ExtensionRecord> = {}): ExtensionRecord => ({
  id,
  displayName: id,
  installedIn,
  applyToAllProfiles: false,
  orphaned: false,
  versions: [],
  ...extra,
});

const inventory = (profiles: Profile[], extensions: ExtensionRecord[], warnings: Inventory['warnings'] = []): Inventory => ({
  profiles,
  extensions,
  warnings,
});

/** Records every call the service makes through its ports, in order. */
function harness(opts: { confirm?: boolean; failOn?: string } = {}) {
  const log: string[] = [];
  const actions = new MatrixActions({
    mutations: {
      install: async (extId, profileName) => {
        log.push(`install ${extId} ${profileName ?? '<default>'}`);
        if (opts.failOn !== undefined && opts.failOn === profileName) throw new Error(`boom in ${profileName}`);
      },
      uninstall: async (extId, profileName) => {
        log.push(`uninstall ${extId} ${profileName ?? '<default>'}`);
        if (opts.failOn !== undefined && opts.failOn === profileName) throw new Error(`boom in ${profileName}`);
      },
    },
    cleanup: {
      deleteFolders: async (folders) => {
        log.push(`delete ${folders.map((f) => f.folderName).join(',')}`);
        return folders.map((f) => ({ folderName: f.folderName, ok: true }));
      },
    },
    ui: {
      confirm: async (message, action) => {
        log.push(`confirm[${action}] ${message}`);
        return opts.confirm ?? true;
      },
      inform: (message) => {
        log.push(`inform ${message}`);
      },
      markPending: (extId, profileId) => {
        log.push(`pending ${extId} ${profileId}`);
      },
      showCleanupResult: (results) => {
        log.push(`result ${results.map((r) => r.folderName).join(',')}`);
      },
    },
    refresh: async () => {
      log.push('refresh');
    },
  });
  return { actions, log };
}

describe('MatrixActions.toggleCell', () => {
  it('installs into a named profile by name, then refreshes', async () => {
    const { actions, log } = harness();
    const inv = inventory([profile('default', 'Default'), profile('w1', 'Work')], [ext('pub.a', ['default'])]);
    await actions.toggleCell(inv, 'pub.a', 'w1', true);
    expect(log).toEqual(['pending pub.a w1', 'install pub.a Work', 'refresh']);
  });

  it('re-syncs without acting on a stale uninstall click the inventory no longer shows', async () => {
    const { actions, log } = harness();
    const inv = inventory([profile('default', 'Default'), profile('w1', 'Work')], [ext('pub.a', ['default'])]);
    await actions.toggleCell(inv, 'pub.a', 'w1', false);
    expect(log).toEqual(['refresh']);
  });

  it('re-syncs without acting on an unknown extension, a profile that inherits Default, or no inventory', async () => {
    const { actions, log } = harness();
    const inv = inventory(
      [profile('default', 'Default'), profile('i1', 'Shared', { inheritsDefaultExtensions: true })],
      [ext('pub.a', ['default', 'i1'])],
    );
    await actions.toggleCell(inv, 'pub.gone', 'default', true);
    await actions.toggleCell(inv, 'pub.a', 'i1', false);
    await actions.toggleCell(undefined, 'pub.a', 'default', false);
    expect(log).toEqual(['refresh', 'refresh', 'refresh']);
  });

  it('re-syncs without acting on a profile a parse warning disabled', async () => {
    const { actions, log } = harness();
    const inv = inventory(
      [profile('default', 'Default'), profile('w1', 'Work')],
      [ext('pub.a', [])],
      [{ file: 'extensions.json (Work)', message: 'bad json', affectedProfileIds: ['w1'] }],
    );
    await actions.toggleCell(inv, 'pub.a', 'w1', true);
    expect(log).toEqual(['refresh']);
  });

  it('asks before uninstalling from the last direct profile, warning about profiles that inherit Default', async () => {
    const { actions, log } = harness();
    const inv = inventory(
      [
        profile('default', 'Default'),
        profile('w1', 'Work'),
        profile('i1', 'Shared', { inheritsDefaultExtensions: true }),
      ],
      // installedIn counts the inheriting profile too; only 'default' is a direct install.
      [ext('pub.a', ['default', 'i1'], { displayName: 'Alpha' })],
    );
    await actions.toggleCell(inv, 'pub.a', 'default', false);
    expect(log).toEqual([
      'confirm[Uninstall] "Alpha" is installed only in the "Default" profile. Uninstall it from your last profile?' +
        " Profiles that inherit the Default profile's extensions (Shared) will also lose it.",
      'pending pub.a default',
      'uninstall pub.a <default>',
      'refresh',
    ]);
  });

  it('re-syncs without uninstalling when the last-profile prompt is dismissed', async () => {
    const { actions, log } = harness({ confirm: false });
    const inv = inventory([profile('default', 'Default'), profile('w1', 'Work')], [ext('pub.a', ['w1'], { displayName: 'Alpha' })]);
    await actions.toggleCell(inv, 'pub.a', 'w1', false);
    expect(log).toEqual([
      'confirm[Uninstall] "Alpha" is installed only in the "Work" profile. Uninstall it from your last profile?',
      'refresh',
    ]);
  });

  it('uninstalls without asking while another profile still has a direct install', async () => {
    const { actions, log } = harness();
    const inv = inventory([profile('default', 'Default'), profile('w1', 'Work')], [ext('pub.a', ['default', 'w1'])]);
    await actions.toggleCell(inv, 'pub.a', 'w1', false);
    expect(log).toEqual(['pending pub.a w1', 'uninstall pub.a Work', 'refresh']);
  });
});

describe('MatrixActions.everyProfile', () => {
  const profiles = () => [
    profile('default', 'Default'),
    profile('w1', 'Work'),
    profile('h1', 'Home'),
    profile('i1', 'Shared', { inheritsDefaultExtensions: true }),
  ];

  it('confirms, marks every target pending, then installs into each missing profile in order', async () => {
    const { actions, log } = harness();
    const inv = inventory(profiles(), [ext('pub.a', ['w1'], { displayName: 'Alpha' })]);
    await actions.everyProfile(inv, 'pub.a', 'install');
    expect(log).toEqual([
      'confirm[Install] Install "Alpha" into 2 profile(s)?\n\nDefault\nHome',
      'pending pub.a default',
      'pending pub.a h1',
      'install pub.a <default>',
      'install pub.a Home',
      'refresh',
    ]);
  });

  it('removes from every direct profile, warning about profiles that inherit Default', async () => {
    const { actions, log } = harness();
    const inv = inventory(profiles(), [ext('pub.a', ['default', 'w1', 'i1'], { displayName: 'Alpha' })]);
    await actions.everyProfile(inv, 'pub.a', 'remove');
    expect(log).toEqual([
      'confirm[Remove] Remove "Alpha" from 2 profile(s)?\n\nDefault\nWork' +
        " Profiles that inherit the Default profile's extensions (Shared) will also lose it.",
      'pending pub.a default',
      'pending pub.a w1',
      'uninstall pub.a <default>',
      'uninstall pub.a Work',
      'refresh',
    ]);
  });

  it('stops at the first failure and lets the error reach the caller', async () => {
    const { actions, log } = harness({ failOn: 'Work' });
    const inv = inventory(profiles(), [ext('pub.a', [])]);
    await expect(actions.everyProfile(inv, 'pub.a', 'install')).rejects.toThrow('boom in Work');
    expect(log.filter((l) => l.startsWith('install'))).toEqual(['install pub.a <default>', 'install pub.a Work']);
  });

  it('says so and re-syncs when there is nothing to do', async () => {
    const { actions, log } = harness();
    const inv = inventory(profiles(), [ext('pub.a', ['default', 'w1', 'h1', 'i1'])]);
    await actions.everyProfile(inv, 'pub.a', 'install');
    await actions.everyProfile(inventory(profiles(), [ext('pub.b', [])]), 'pub.b', 'remove');
    expect(log).toEqual([
      'inform Already installed in every profile.',
      'refresh',
      'inform Not directly installed in any profile.',
      'refresh',
    ]);
  });

  it('re-syncs without acting when the prompt is dismissed or the extension is unknown', async () => {
    const { actions, log } = harness({ confirm: false });
    const inv = inventory(profiles(), [ext('pub.a', [])]);
    await actions.everyProfile(inv, 'pub.a', 'install');
    await actions.everyProfile(inv, 'pub.gone', 'remove');
    expect(log).toEqual(['confirm[Install] Install "pub.a" into 3 profile(s)?\n\nDefault\nWork\nHome', 'refresh', 'refresh']);
  });
});

describe('MatrixActions.cleanup', () => {
  const version = (folderName: string) => ({ version: '1.0.0', folderName, fsPath: `/ext/${folderName}` });
  const inv = () =>
    inventory(
      [profile('default', 'Default')],
      [
        ext('pub.old', [], { orphaned: true, versions: [version('pub.old-1.0.0')] }),
        ext('pub.live', ['default'], { versions: [version('pub.live-1.0.0')] }),
      ],
    );

  it('moves only the requested orphan folders to the trash, ignoring non-orphan names', async () => {
    const { actions, log } = harness();
    await actions.cleanup(inv(), ['pub.old-1.0.0', 'pub.live-1.0.0']);
    expect(log).toEqual([
      'confirm[Move to Trash] Move 1 extension folder(s) to the Recycle Bin/Trash?\n\npub.old-1.0.0',
      'delete pub.old-1.0.0',
      'result pub.old-1.0.0',
      'refresh',
    ]);
  });

  it('never asks to move zero folders when no requested name is an orphan', async () => {
    const { actions, log } = harness();
    await actions.cleanup(inv(), ['pub.live-1.0.0', 'pub.unknown-2.0.0']);
    expect(log).toEqual(['inform None of the selected folders belong to an orphaned extension any more.', 'refresh']);
  });

  it('re-syncs without deleting when the prompt is dismissed', async () => {
    const { actions, log } = harness({ confirm: false });
    await actions.cleanup(inv(), ['pub.old-1.0.0']);
    expect(log).toEqual([
      'confirm[Move to Trash] Move 1 extension folder(s) to the Recycle Bin/Trash?\n\npub.old-1.0.0',
      'refresh',
    ]);
  });
});
