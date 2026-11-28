import { areFsPathsEqual, isFsPathContained, type Platform } from './paths';
import type { ExtensionRecord, Inventory } from './types';

export const TOGGLE_APPLY_TO_ALL_PROFILES_COMMAND =
  'workbench.extensions.action.toggleApplyToAllProfiles';

export interface RuntimeExtensionCandidate {
  id: string;
  location: unknown;
  scheme: string;
  fsPath?: string;
  extensionPack: readonly string[];
  extensionDependencies: readonly string[];
}

export interface ExperimentalApplyToAllProfilesAvailability {
  enabled: boolean;
  commandAvailable: boolean;
  eligibleExtensionIds: string[];
}

export type ExperimentalApplyToAllProfilesResult =
  | { kind: 'applied'; displayName: string }
  | { kind: 'alreadyApplied'; displayName: string }
  | { kind: 'cancelled' }
  | { kind: 'fallback'; reason: string };

interface ReadyPreflight {
  kind: 'ready';
  extension: ExtensionRecord;
  target: RuntimeExtensionCandidate;
}

type Preflight = ReadyPreflight | Exclude<ExperimentalApplyToAllProfilesResult, { kind: 'applied' | 'cancelled' }>;

export interface ExperimentalApplyToAllProfilesOptions {
  isEnabled(): boolean;
  readInventory(): Promise<Inventory>;
  commandAvailable(): Promise<boolean>;
  runtimeExtension(extensionId: string): RuntimeExtensionCandidate | undefined;
  runtimeExtensions(): readonly RuntimeExtensionCandidate[];
  canonicalize(fsPath: string): Promise<string>;
  extensionsDir: string;
  platform: Platform;
  executeToggle(extensionId: string, location: unknown): Promise<void>;
}

/**
 * Guarded adapter around VS Code's unsupported application-scope toggle. The extension host owns
 * every check; webview eligibility is only a presentation hint and never authorizes a mutation.
 */
export class ExperimentalApplyToAllProfilesService {
  constructor(private readonly options: ExperimentalApplyToAllProfilesOptions) {}

  /** What a fresh matrix may advertise. Execution repeats every one of these checks. */
  async availability(inventory: Inventory): Promise<ExperimentalApplyToAllProfilesAvailability> {
    const enabled = this.options.isEnabled();
    const commandAvailable = enabled && (await this.options.commandAvailable());
    if (
      !enabled ||
      !commandAvailable ||
      inventory.applicationScopeStateKnown !== true ||
      inventory.extensionRelationshipStateKnown !== true
    ) {
      return { enabled, commandAvailable, eligibleExtensionIds: [] };
    }

    const runtimes = this.options.runtimeExtensions();
    let canonicalPool: string;
    try {
      canonicalPool = await this.options.canonicalize(this.options.extensionsDir);
    } catch {
      return { enabled, commandAvailable, eligibleExtensionIds: [] };
    }
    const eligibleExtensionIds: string[] = [];
    for (const extension of inventory.extensions) {
      if (extension.applyToAllProfiles) continue;
      if (await this.eligibleTarget(extension.id, inventory, runtimes, canonicalPool)) {
        eligibleExtensionIds.push(extension.id);
      }
    }
    return { enabled, commandAvailable, eligibleExtensionIds };
  }

  async apply(
    extensionId: string,
    confirm: (displayName: string) => Promise<boolean>,
  ): Promise<ExperimentalApplyToAllProfilesResult> {
    let preflight = await this.preflight(extensionId);
    if (preflight.kind !== 'ready') return preflight;

    if (!(await confirm(preflight.extension.displayName))) return { kind: 'cancelled' };

    // The modal can stay open while settings or extension state change. Rebuild the complete
    // preflight immediately before execution rather than trusting the earlier snapshot.
    preflight = await this.preflight(extensionId);
    if (preflight.kind !== 'ready') return preflight;

    await this.options.executeToggle(preflight.extension.id, preflight.target.location);

    const after = await this.options.readInventory();
    if (after.applicationScopeStateKnown !== true) {
      throw new Error('Could not verify Apply Extension to all Profiles because profile data became unreadable.');
    }
    const verified = after.extensions.find((extension) => extension.id === preflight.extension.id);
    if (!verified?.applyToAllProfiles) {
      throw new Error(`VS Code did not report "${preflight.extension.displayName}" as applied to all profiles.`);
    }
    return { kind: 'applied', displayName: preflight.extension.displayName };
  }

  private async preflight(extensionId: string): Promise<Preflight> {
    if (!this.options.isEnabled()) {
      return { kind: 'fallback', reason: 'Experimental features are disabled in Personas settings.' };
    }

    const inventory = await this.options.readInventory();
    if (inventory.applicationScopeStateKnown !== true) {
      return {
        kind: 'fallback',
        reason: 'Personas cannot safely determine the current application-scope state from the profile manifests.',
      };
    }
    if (inventory.extensionRelationshipStateKnown !== true) {
      return {
        kind: 'fallback',
        reason: 'Personas cannot safely exclude extension-pack or dependency relationships from unreadable package metadata.',
      };
    }

    const extension = inventory.extensions.find((candidate) => candidate.id === extensionId);
    if (!extension) {
      return { kind: 'fallback', reason: 'The extension is no longer present in the current inventory.' };
    }
    if (extension.applyToAllProfiles) {
      return { kind: 'alreadyApplied', displayName: extension.displayName };
    }
    if (!(await this.options.commandAvailable())) {
      return { kind: 'fallback', reason: "This VS Code version does not expose the experimental command." };
    }

    const target = await this.eligibleTarget(extension.id, inventory);
    if (!target) {
      return {
        kind: 'fallback',
        reason: 'This extension is not an eligible ordinary local installation in the active profile.',
      };
    }
    return { kind: 'ready', extension, target };
  }

  private async eligibleTarget(
    extensionId: string,
    inventory: Inventory,
    runtimes: readonly RuntimeExtensionCandidate[] = this.options.runtimeExtensions(),
    canonicalPool?: string,
  ): Promise<RuntimeExtensionCandidate | undefined> {
    const normalizedId = extensionId.toLowerCase();
    const target = this.options.runtimeExtension(extensionId);
    if (
      !target ||
      target.id.toLowerCase() !== normalizedId ||
      target.scheme !== 'file' ||
      !target.fsPath
    ) return undefined;

    const declaresRelationships = target.extensionPack.length > 0 || target.extensionDependencies.length > 0;
    const inventoryTarget = inventory.extensions.find((extension) => extension.id === normalizedId);
    const declaresInventoryRelationships =
      (inventoryTarget?.extensionPack?.length ?? 0) > 0 ||
      (inventoryTarget?.extensionDependencies?.length ?? 0) > 0;
    const isReferencedByRuntime = runtimes.some((extension) =>
      [...extension.extensionPack, ...extension.extensionDependencies]
        .some((relatedId) => relatedId.toLowerCase() === normalizedId),
    );
    const isReferencedByInventory = inventory.extensions.some((extension) =>
      [...(extension.extensionPack ?? []), ...(extension.extensionDependencies ?? [])]
        .some((relatedId) => relatedId.toLowerCase() === normalizedId),
    );
    if (
      declaresRelationships ||
      declaresInventoryRelationships ||
      isReferencedByRuntime ||
      isReferencedByInventory
    ) return undefined;

    try {
      const [pool, installed] = await Promise.all([
        canonicalPool ?? this.options.canonicalize(this.options.extensionsDir),
        this.options.canonicalize(target.fsPath),
      ]);
      if (
        areFsPathsEqual(pool, installed, this.options.platform) ||
        !isFsPathContained(pool, installed, this.options.platform)
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return target;
  }
}
