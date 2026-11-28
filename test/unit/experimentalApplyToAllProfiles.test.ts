import { expect, it, vi } from 'vitest';
import {
  ExperimentalApplyToAllProfilesService,
  isVerifiedApplyToAllProfilesVersion,
  type RuntimeExtensionCandidate,
} from '../../src/core/experimentalApplyToAllProfiles';
import type { Inventory } from '../../src/core/types';

const snapshot: Inventory = {
  profiles: [],
  extensions: [{
    id: 'pub.alpha', displayName: 'Alpha', versions: [], installedIn: ['default'],
    applyToAllProfiles: false, orphaned: false,
  }],
  warnings: [],
  applicationScopeStateKnown: true,
  extensionRelationshipStateKnown: true,
};

const appliedSnapshot: Inventory = {
  ...snapshot,
  extensions: [{ ...snapshot.extensions[0]!, applyToAllProfiles: true }],
};

const target: RuntimeExtensionCandidate = {
  id: 'pub.alpha', location: { fsPath: '/extensions/pub.alpha-1.0.0' },
  scheme: 'file', fsPath: '/extensions/pub.alpha-1.0.0',
  extensionPack: [], extensionDependencies: [],
};

interface ServiceOptions {
  enabled?: boolean;
  commandAvailable?: boolean;
  runtimes?: RuntimeExtensionCandidate[];
  extensionsDir?: string;
  canonicalize?: (path: string) => Promise<string>;
}

function service(inventories: Inventory[], {
  enabled = true,
  commandAvailable = true,
  runtimes = [target],
  extensionsDir = '/extensions',
  canonicalize = async (path) => path,
}: ServiceOptions = {}) {
  const log: string[] = [];
  return {
    log,
    value: new ExperimentalApplyToAllProfilesService({
      isEnabled: () => enabled,
      readInventory: async () => inventories.shift()!,
      commandAvailable: async () => commandAvailable,
      runtimeExtension: () => runtimes[0],
      runtimeExtensions: () => runtimes,
      canonicalize,
      extensionsDir,
      platform: 'linux',
      executeToggle: async (id, location) => {
        log.push(`${id} ${(location as { fsPath: string }).fsPath}`);
      },
    }),
  };
}

it('guards, applies, verifies, and remains idempotent without retrying failures', async () => {
    expect(isVerifiedApplyToAllProfilesVersion('1.101.0')).toBe(true);
    expect(isVerifiedApplyToAllProfilesVersion('1.148.7')).toBe(true);
    expect(isVerifiedApplyToAllProfilesVersion('1.100.9')).toBe(false);
    expect(isVerifiedApplyToAllProfilesVersion('1.149.0')).toBe(false);
    expect(isVerifiedApplyToAllProfilesVersion('invalid')).toBe(false);

    const confirm = vi.fn().mockResolvedValue(true);
    const apply = service([snapshot, snapshot, appliedSnapshot]);
    await expect(apply.value.apply('pub.alpha', confirm)).resolves.toEqual({
      kind: 'applied', displayName: 'Alpha',
    });
    expect(apply.log).toEqual(['pub.alpha /extensions/pub.alpha-1.0.0']);

    const already = service([appliedSnapshot]);
    const shouldNotConfirm = vi.fn();
    await expect(already.value.apply('pub.alpha', shouldNotConfirm)).resolves.toEqual({
      kind: 'alreadyApplied', displayName: 'Alpha',
    });
    expect(shouldNotConfirm).not.toHaveBeenCalled();
    expect(already.log).toEqual([]);

    const disabled = service([snapshot], { enabled: false });
    await expect(disabled.value.availability(snapshot)).resolves.toEqual({
      enabled: false, commandAvailable: false, eligibleExtensionIds: [],
    });
    await expect(disabled.value.apply('pub.alpha', shouldNotConfirm)).resolves.toEqual({
      kind: 'fallback', reason: 'Experimental features are disabled in Personas settings.',
    });
    expect(disabled.log).toEqual([]);

    const missingCommand = service([snapshot], { commandAvailable: false });
    await expect(missingCommand.value.availability(snapshot)).resolves.toEqual({
      enabled: true, commandAvailable: false, eligibleExtensionIds: [],
    });
    await expect(missingCommand.value.apply('pub.alpha', shouldNotConfirm)).resolves.toEqual({
      kind: 'fallback', reason: 'This VS Code version is not verified for the experimental command.',
    });
    expect(missingCommand.log).toEqual([]);

    const cancelled = service([snapshot]);
    const decline = vi.fn().mockResolvedValue(false);
    await expect(cancelled.value.apply('pub.alpha', decline)).resolves.toEqual({ kind: 'cancelled' });
    expect(cancelled.log).toEqual([]);

    const unknownScope = service([{ ...snapshot, applicationScopeStateKnown: false }]);
    await expect(unknownScope.value.apply('pub.alpha', shouldNotConfirm)).resolves.toMatchObject({
      kind: 'fallback', reason: expect.stringContaining('current application-scope state'),
    });

    const missingRuntime = service([snapshot], { runtimes: [] });
    await expect(missingRuntime.value.apply('pub.alpha', shouldNotConfirm)).resolves.toMatchObject({
      kind: 'fallback', reason: expect.stringContaining('eligible ordinary local installation'),
    });

    const missingPath = service([snapshot], { runtimes: [{ ...target, fsPath: undefined }] });
    await expect(missingPath.value.apply('pub.alpha', shouldNotConfirm)).resolves.toMatchObject({
      kind: 'fallback', reason: expect.stringContaining('eligible ordinary local installation'),
    });

    const outsidePool = service([snapshot], {
      runtimes: [{
        ...target,
        location: { fsPath: '/outside/pub.alpha-1.0.0' },
        fsPath: '/outside/pub.alpha-1.0.0',
      }],
    });
    await expect(outsidePool.value.apply('pub.alpha', shouldNotConfirm)).resolves.toMatchObject({
      kind: 'fallback', reason: expect.stringContaining('eligible ordinary local installation'),
    });

    const packMember = service([snapshot], {
      runtimes: [target, {
        id: 'pub.pack', location: { fsPath: '/extensions/pub.pack-1.0.0' },
        scheme: 'file', fsPath: '/extensions/pub.pack-1.0.0',
        extensionPack: ['pub.alpha'], extensionDependencies: [],
      }],
    });
    await expect(packMember.value.apply('pub.alpha', shouldNotConfirm)).resolves.toMatchObject({
      kind: 'fallback', reason: expect.stringContaining('eligible ordinary local installation'),
    });

    const incomplete = service([{ ...snapshot, extensionRelationshipStateKnown: false }]);
    await expect(incomplete.value.apply('pub.alpha', confirm)).resolves.toMatchObject({ kind: 'fallback' });

    const remote = service([snapshot], { runtimes: [{ ...target, scheme: 'vscode-remote' }] });
    await expect(remote.value.availability(snapshot)).resolves.toMatchObject({ eligibleExtensionIds: [] });

    const mismatch = service([snapshot, snapshot, snapshot]);
    await expect(mismatch.value.apply('pub.alpha', confirm)).rejects.toThrow(
      'VS Code did not report "Alpha" as applied to all profiles.',
    );
    expect(mismatch.log).toHaveLength(1);
});
