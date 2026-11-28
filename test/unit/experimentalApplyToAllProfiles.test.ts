import { describe, expect, it } from 'vitest';
import {
  ExperimentalApplyToAllProfilesService,
  type RuntimeExtensionCandidate,
} from '../../src/core/experimentalApplyToAllProfiles';
import type { Inventory } from '../../src/core/types';

const before = (extra: Partial<Inventory> = {}): Inventory => ({
  profiles: [],
  extensions: [{
    id: 'pub.alpha',
    displayName: 'Alpha',
    versions: [],
    installedIn: ['default'],
    applyToAllProfiles: false,
    orphaned: false,
  }],
  warnings: [],
  applicationScopeStateKnown: true,
  extensionRelationshipStateKnown: true,
  ...extra,
});

const applied = (): Inventory => ({
  ...before(),
  extensions: [{ ...before().extensions[0]!, applyToAllProfiles: true }],
});

const runtime = (extra: Partial<RuntimeExtensionCandidate> = {}): RuntimeExtensionCandidate => ({
  id: 'pub.alpha',
  location: { scheme: 'file', fsPath: '/extensions/pub.alpha-1.0.0' },
  scheme: 'file',
  fsPath: '/extensions/pub.alpha-1.0.0',
  extensionPack: [],
  extensionDependencies: [],
  ...extra,
});

function harness(options: {
  enabled?: boolean;
  command?: boolean;
  inventories?: Inventory[];
  runtimes?: RuntimeExtensionCandidate[];
  canonicalize?: (path: string) => Promise<string>;
} = {}) {
  const log: string[] = [];
  const inventories = [...(options.inventories ?? [before()])];
  const service = new ExperimentalApplyToAllProfilesService({
    isEnabled: () => options.enabled ?? true,
    readInventory: async () => {
      log.push('read');
      return inventories.shift() ?? before();
    },
    commandAvailable: async () => {
      log.push('command');
      return options.command ?? true;
    },
    runtimeExtension: (extensionId) =>
      (options.runtimes ?? [runtime()]).find((candidate) => candidate.id === extensionId),
    runtimeExtensions: () => options.runtimes ?? [runtime()],
    canonicalize: options.canonicalize ?? (async (path) => path),
    extensionsDir: '/extensions',
    platform: 'linux',
    executeToggle: async (extensionId, location) => {
      log.push(`execute ${extensionId} ${(location as { fsPath: string }).fsPath}`);
    },
  });
  return { service, log };
}

describe('ExperimentalApplyToAllProfilesService.availability', () => {
  it('advertises only a known, registered, ordinary local runtime extension', async () => {
    const { service } = harness();
    await expect(service.availability(before())).resolves.toEqual({
      enabled: true,
      commandAvailable: true,
      eligibleExtensionIds: ['pub.alpha'],
    });
  });

  it('advertises nothing when disabled, missing the command, or application scope is unknown', async () => {
    const disabled = harness({ enabled: false });
    await expect(disabled.service.availability(before())).resolves.toEqual({
      enabled: false,
      commandAvailable: false,
      eligibleExtensionIds: [],
    });
    expect(disabled.log).toEqual([]);

    await expect(harness({ command: false }).service.availability(before())).resolves.toMatchObject({
      commandAvailable: false,
      eligibleExtensionIds: [],
    });
    await expect(harness().service.availability(before({ applicationScopeStateKnown: false }))).resolves.toMatchObject({
      eligibleExtensionIds: [],
    });
  });

  it('rejects non-file, outside-pool, and unresolvable runtime paths', async () => {
    for (const candidate of [
      runtime({ scheme: 'vscode-remote', fsPath: undefined }),
      runtime({ fsPath: '/other/pub.alpha-1.0.0' }),
    ]) {
      await expect(harness({ runtimes: [candidate] }).service.availability(before())).resolves.toMatchObject({
        eligibleExtensionIds: [],
      });
    }
    await expect(harness({ canonicalize: async () => { throw new Error('no realpath'); } }).service.availability(before()))
      .resolves.toMatchObject({ eligibleExtensionIds: [] });
  });

  it('rejects extension packs and both sides of dependency relationships', async () => {
    const declaring = runtime({ extensionPack: ['pub.beta'] });
    const referencing = runtime({ id: 'pub.beta', fsPath: '/extensions/pub.beta-1.0.0', extensionDependencies: ['PUB.ALPHA'] });
    await expect(harness({ runtimes: [declaring] }).service.availability(before())).resolves.toMatchObject({
      eligibleExtensionIds: [],
    });
    await expect(harness({ runtimes: [runtime(), referencing] }).service.availability(before())).resolves.toMatchObject({
      eligibleExtensionIds: [],
    });
    const inventoryReference = before({
      extensions: [
        before().extensions[0]!,
        {
          id: 'pub.beta', displayName: 'Beta', versions: [], installedIn: ['default'],
          applyToAllProfiles: false, orphaned: false, extensionPack: ['PUB.ALPHA'],
        },
      ],
    });
    await expect(harness().service.availability(inventoryReference)).resolves.toMatchObject({
      eligibleExtensionIds: [],
    });
  });
});

describe('ExperimentalApplyToAllProfilesService.apply', () => {
  it('confirms, rechecks, passes the private two-argument context, and verifies the saved state', async () => {
    const { service, log } = harness({ inventories: [before(), before(), applied()] });
    const result = await service.apply('pub.alpha', async (displayName) => {
      log.push(`confirm ${displayName}`);
      return true;
    });
    expect(result).toEqual({ kind: 'applied', displayName: 'Alpha' });
    expect(log).toEqual([
      'read', 'command', 'confirm Alpha',
      'read', 'command', 'execute pub.alpha /extensions/pub.alpha-1.0.0',
      'read',
    ]);
  });

  it('does not invoke the toggle when already applied or confirmation is cancelled', async () => {
    const already = harness({ inventories: [applied()] });
    await expect(already.service.apply('pub.alpha', async () => { throw new Error('should not confirm'); }))
      .resolves.toEqual({ kind: 'alreadyApplied', displayName: 'Alpha' });
    expect(already.log).toEqual(['read']);

    const cancelled = harness();
    await expect(cancelled.service.apply('pub.alpha', async () => false)).resolves.toEqual({ kind: 'cancelled' });
    expect(cancelled.log).not.toContain(expect.stringMatching(/^execute/));
  });

  it('falls back for disabled, unknown, missing-command, missing-runtime, and ineligible targets', async () => {
    const cases = [
      harness({ enabled: false }),
      harness({ inventories: [before({ applicationScopeStateKnown: false })] }),
      harness({ inventories: [before({ extensionRelationshipStateKnown: false })] }),
      harness({ command: false }),
      harness({ runtimes: [] }),
      harness({ runtimes: [runtime({ extensionDependencies: ['pub.beta'] })] }),
    ];
    for (const { service, log } of cases) {
      await expect(service.apply('pub.alpha', async () => true)).resolves.toMatchObject({ kind: 'fallback' });
      expect(log).not.toContain(expect.stringMatching(/^execute/));
    }
  });

  it('fails verification without retrying the private toggle', async () => {
    const mismatch = harness({ inventories: [before(), before(), before()] });
    await expect(mismatch.service.apply('pub.alpha', async () => true)).rejects.toThrow(
      'VS Code did not report "Alpha" as applied to all profiles.',
    );
    expect(mismatch.log.filter((entry) => entry.startsWith('execute'))).toHaveLength(1);

    const unknown = harness({ inventories: [before(), before(), before({ applicationScopeStateKnown: false })] });
    await expect(unknown.service.apply('pub.alpha', async () => true)).rejects.toThrow('profile data became unreadable');
    expect(unknown.log.filter((entry) => entry.startsWith('execute'))).toHaveLength(1);
  });
});
