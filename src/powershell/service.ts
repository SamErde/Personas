import * as path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { buildProfileLocations, type EditionInfo, type PowerShellInventory, type PowerShellPreferences, type ProfileRow } from './profiles';
import { discoverPowerShell, documentsDirectory, isPowerShellHome, probeInstallation, userProfileDirectory } from './discovery';
import { inspectProfile } from './files';

type ProbeResult = {home: string; userDirectory: string};
type CachedProbeOutcome = {result: ProbeResult} | {error: unknown};
type ProbeOutcome = CachedProbeOutcome | {skipped: true};
export interface PowerShellRefresh {
  initial: PowerShellInventory;
  settled: Promise<PowerShellInventory | undefined>;
  generation: number;
}

const passivePreferences: PowerShellPreferences = {
  allowRuntimeDiscovery: false,
  includeWindowsPowerShell: true,
};
const disagreementReason = 'PowerShell installations disagree on the current-user profile location.';

function cloneEditions(editions: readonly EditionInfo[]): EditionInfo[] {
  return editions.map(edition => ({
    ...edition,
    installations: edition.installations.map(installation => ({...installation})),
  }));
}

function preferencesOf(preferences: PowerShellPreferences | boolean): PowerShellPreferences {
  return typeof preferences === 'boolean'
    ? {...passivePreferences, includeWindowsPowerShell: preferences}
    : preferences;
}

function needsResolution(edition: EditionInfo): boolean {
  return [
    edition.installations.length > 0,
    [!edition.userDirectory, edition.installations.some(item => !item.home)].some(Boolean),
  ].every(Boolean);
}

export class PowerShellService {
  private outcomes = new Map<string, CachedProbeOutcome>();
  private inFlight = new Map<string, Promise<ProbeOutcome>>();
  private activeProbes = 0;
  private probeWaiters: Array<()=>void> = [];
  private registryDocuments?: Promise<string | undefined>;
  private resolvedRegistryDocuments?: string;
  generation = 0;
  private runtimeDiscoveryAllowed = false;
  private windowsPowerShellIncluded = true;
  private current: PowerShellInventory = { editions: [], rows: [] };
  constructor(
    private readonly discover = (includeWindowsPowerShell: boolean) => discoverPowerShell(undefined, includeWindowsPowerShell),
    private readonly probe = probeInstallation,
    private readonly platform = process.platform,
    private readonly holdsPowerShell = isPowerShellHome,
    private readonly readDocuments = documentsDirectory,
  ) {}

  async refresh(
    preferences: PowerShellPreferences | boolean = passivePreferences,
    retryFailures = false,
  ): Promise<PowerShellRefresh> {
    const effective = preferencesOf(preferences);
    this.setRuntimeDiscoveryAllowed(effective.allowRuntimeDiscovery);
    this.setWindowsPowerShellIncluded(effective.includeWindowsPowerShell);
    if (retryFailures) {
      this.outcomes = new Map([...this.outcomes].filter(([, outcome]) => 'result' in outcome));
      this.registryDocuments = undefined;
      this.resolvedRegistryDocuments = undefined;
    }
    const generation = ++this.generation;
    const discovered = await this.discover(effective.includeWindowsPowerShell);
    const initialEditions = cloneEditions(discovered);
    for (const edition of initialEditions) await this.applyEditionCache(edition);
    const pending = initialEditions.filter(needsResolution);
    pending.forEach(edition => { edition.resolving = true; });
    const initial = await this.compose(initialEditions);
    if (generation === this.generation) this.current = initial;

    if (!pending.length) return {initial, settled:Promise.resolve(undefined), generation};
    const working = cloneEditions(initialEditions);
    const settled = this.settle(generation, working, effective);
    return {initial, settled, generation};
  }

  setRuntimeDiscoveryAllowed(allowed: boolean): void {
    if (this.runtimeDiscoveryAllowed === allowed) return;
    this.runtimeDiscoveryAllowed = allowed;
    if (!allowed) this.generation++;
  }

  setWindowsPowerShellIncluded(included: boolean): void {
    if (this.windowsPowerShellIncluded === included) return;
    this.windowsPowerShellIncluded = included;
    this.generation++;
  }

  get snapshot(): PowerShellInventory { return this.current; }
  row(id: string): ProfileRow | undefined { return this.current.rows.find(row => row.id === id); }

  async resolve(installationId: string, preferences: PowerShellPreferences): Promise<void> {
    this.setRuntimeDiscoveryAllowed(preferences.allowRuntimeDiscovery);
    this.setWindowsPowerShellIncluded(preferences.includeWindowsPowerShell);
    if (!preferences.allowRuntimeDiscovery) throw new Error('Runtime discovery is off');
    const generation = this.generation;
    for (const edition of this.current.editions) {
      if (!preferences.includeWindowsPowerShell && edition.edition === 'Windows PowerShell') continue;
      const installation = edition.installations.find(item => item.id === installationId);
      if (!installation) continue;
      const outcome = await this.probeFresh(
        installation, edition, () => this.canProbe(generation, true, edition.edition),
      );
      if ('result' in outcome) return;
      if ('error' in outcome) throw outcome.error;
      const included = edition.edition !== 'Windows PowerShell' || this.windowsPowerShellIncluded;
      const state = Number(this.runtimeDiscoveryAllowed) * (1 + Number(included));
      throw new Error([
        'Runtime discovery is off',
        'Windows PowerShell is excluded in Personas Settings',
        'Runtime discovery request was superseded; retry',
      ][state]);
    }
    throw new Error('Installation is no longer available; refresh first');
  }

  private async settle(
    generation: number,
    editions: EditionInfo[],
    preferences: PowerShellPreferences,
  ): Promise<PowerShellInventory | undefined> {
    await nextTurn();
    await Promise.all(editions.map(edition => this.resolveEdition(edition, generation, preferences.allowRuntimeDiscovery)));
    const inventory = await this.compose(editions);
    if (generation !== this.generation) return undefined;
    this.current = inventory;
    return inventory;
  }

  private async resolveEdition(edition: EditionInfo, generation: number, allowRuntime: boolean): Promise<void> {
    try {
      if (edition.reason === disagreementReason) return;
      const directories = new Set(
        [edition.userDirectory].filter((value): value is string => !!value).map(value => this.directoryKey(value)),
      );
      if (allowRuntime) {
        await this.resolveRuntime(
          edition, directories, () => this.canProbe(generation, allowRuntime, edition.edition),
        );
      }
      this.applySuccessfulOutcomes(edition, directories);
      if (directories.size > 1) {
        edition.userDirectory = undefined;
        edition.reason = disagreementReason;
        return;
      }
      await this.applyRegistryFallback(edition);
      if (!edition.userDirectory && edition.installations.length) {
        edition.reason = 'Profile location unresolved after PowerShell and registry checks.';
      }
    } finally {
      edition.resolving = false;
    }
  }

  private canProbe(
    generation: number, allowedAtStart: boolean, edition: EditionInfo['edition'],
  ): boolean {
    const editionAllowed = Number(edition === 'Windows PowerShell') <= Number(this.windowsPowerShellIncluded);
    return [allowedAtStart,this.runtimeDiscoveryAllowed,generation === this.generation,editionAllowed].every(Boolean);
  }

  private async resolveRuntime(
    edition: EditionInfo, directories: Set<string>, canStart: () => boolean,
  ): Promise<void> {
    if (!edition.userDirectory) await this.resolveUserDirectory(edition, directories, canStart);
    const unresolved = edition.installations.filter(installation => !installation.home);
    await Promise.all(unresolved.map(installation => this.resolveHome(installation, edition, directories, canStart)));
  }

  /** A failed preferred installation must not hide a viable alternative in the same edition. */
  private async resolveUserDirectory(
    edition: EditionInfo, directories: Set<string>, canStart: () => boolean,
  ): Promise<void> {
    for (const installation of edition.installations) {
      const outcome = await this.probeCached(installation, edition, canStart);
      if ('skipped' in outcome) return;
      if ('error' in outcome) continue;
      installation.home ??= outcome.result.home;
      directories.add(this.directoryKey(outcome.result.userDirectory));
      edition.userDirectory = outcome.result.userDirectory;
      return;
    }
  }

  private async resolveHome(
    installation: EditionInfo['installations'][number], edition: EditionInfo, directories: Set<string>,
    canStart: () => boolean,
  ): Promise<void> {
    const outcome = await this.probeCached(installation, edition, canStart);
    if (!('result' in outcome)) return;
    installation.home = outcome.result.home;
    directories.add(this.directoryKey(outcome.result.userDirectory));
  }

  /** Cached successes on installations skipped above still participate in disagreement checks. */
  private applySuccessfulOutcomes(edition: EditionInfo, directories: Set<string>): void {
    for (const installation of edition.installations) {
      const outcome = this.outcomes.get(installation.executable);
      if (!outcome || 'error' in outcome) continue;
      installation.home ??= outcome.result.home;
      directories.add(this.directoryKey(outcome.result.userDirectory));
      edition.userDirectory ??= outcome.result.userDirectory;
    }
  }

  private async applyRegistryFallback(edition: EditionInfo): Promise<void> {
    if ([edition.userDirectory,this.platform !== 'win32',!edition.installations.length].some(Boolean)) return;
    this.registryDocuments ??= this.readDocuments().catch(() => undefined);
    const pending = this.registryDocuments;
    const documents = await pending;
    if (this.registryDocuments === pending) this.resolvedRegistryDocuments = documents;
    edition.userDirectory = userProfileDirectory(this.platform, edition.edition, process.env, '', documents);
  }

  private async applyEditionCache(edition: EditionInfo): Promise<void> {
    const directories = new Map<string, string>();
    if (edition.userDirectory) directories.set(this.directoryKey(edition.userDirectory), edition.userDirectory);
    for (const installation of edition.installations) {
      const result = await this.validCachedResult(installation);
      if (!result) continue;
      installation.home ??= result.home;
      directories.set(this.directoryKey(result.userDirectory), result.userDirectory);
    }
    this.applyDirectoryAgreement(edition, directories);
    const documents = this.resolvedRegistryDocuments;
    const useRegistry = [
      !edition.userDirectory, this.platform === 'win32', edition.installations.length > 0,
      edition.reason !== disagreementReason, documents,
    ].every(Boolean);
    if (useRegistry) {
      edition.userDirectory = userProfileDirectory(this.platform, edition.edition, process.env, '', documents);
    }
  }

  private async validCachedResult(
    installation: EditionInfo['installations'][number],
  ): Promise<ProbeResult | undefined> {
    const outcome = this.outcomes.get(installation.executable);
    if (!outcome || 'error' in outcome) return undefined;
    if (!installation.home) {
      const valid = await this.holdsPowerShell(outcome.result.home);
      if (this.outcomes.get(installation.executable) !== outcome) {
        return this.validCachedResult(installation);
      }
      if (valid) return outcome.result;
      this.outcomes.delete(installation.executable);
      return undefined;
    }
    return outcome.result;
  }

  private applyDirectoryAgreement(edition: EditionInfo, directories: Map<string, string>): void {
    if (!directories.size) return;
    if (directories.size === 1) {
      edition.userDirectory = directories.values().next().value;
      return;
    }
    edition.userDirectory = undefined;
    edition.reason = disagreementReason;
  }

  private probeCached(
    installation: EditionInfo['installations'][number], edition: EditionInfo, canStart: () => boolean,
  ): Promise<ProbeOutcome> {
    const running = this.inFlight.get(installation.executable);
    if (running) return this.joinProbe(running, installation, edition, canStart, false);
    const cached = this.outcomes.get(installation.executable);
    if (cached) return Promise.resolve(cached);
    return this.probeFresh(installation, edition, canStart);
  }

  private probeFresh(
    installation: EditionInfo['installations'][number], edition: EditionInfo, canStart: () => boolean,
  ): Promise<ProbeOutcome> {
    const running = this.inFlight.get(installation.executable);
    if (running) return this.joinProbe(running, installation, edition, canStart, true);
    const promise = this.runProbe(installation, edition, canStart).then(outcome => {
      const current = this.outcomes.get(installation.executable);
      if ('result' in outcome || 'error' in outcome && !(current && 'result' in current)) {
        this.outcomes.set(installation.executable, outcome);
      }
      return outcome;
    }).finally(() => {
      if (this.inFlight.get(installation.executable) === promise) this.inFlight.delete(installation.executable);
    });
    this.inFlight.set(installation.executable, promise);
    return promise;
  }

  private async joinProbe(
    running: Promise<ProbeOutcome>, installation: EditionInfo['installations'][number],
    edition: EditionInfo, canStart: () => boolean, fresh: boolean,
  ): Promise<ProbeOutcome> {
    const outcome = await running;
    if (!('skipped' in outcome) || !canStart()) return outcome;
    return fresh
      ? this.probeFresh(installation, edition, canStart)
      : this.probeCached(installation, edition, canStart);
  }

  private async runProbe(
    installation: EditionInfo['installations'][number], edition: EditionInfo, canStart: () => boolean,
  ): Promise<ProbeOutcome> {
    await this.acquireProbeSlot();
    try {
      if (!canStart()) return {skipped:true};
      try { return {result:await this.probe(installation, edition.edition)}; }
      catch (error) { return {error}; }
    } finally {
      this.releaseProbeSlot();
    }
  }

  private async acquireProbeSlot(): Promise<void> {
    if (this.activeProbes < 2) {
      this.activeProbes++;
      return;
    }
    await new Promise<void>(resolve => this.probeWaiters.push(resolve));
  }

  private releaseProbeSlot(): void {
    const waiter = this.probeWaiters.shift();
    if (waiter) waiter();
    else this.activeProbes--;
  }

  private async compose(editions: EditionInfo[]): Promise<PowerShellInventory> {
    const rows = await Promise.all(buildProfileLocations(this.platform, editions).map(inspectProfile));
    return {editions, rows};
  }

  private directoryKey(value: string): string {
    const windows = Number(this.platform === 'win32');
    const paths = [path.posix,path.win32][windows]!;
    const normalized = paths.normalize(value);
    return [normalized,normalized.toLowerCase()][windows]!;
  }

}
