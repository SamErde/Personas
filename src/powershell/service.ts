import * as path from 'node:path';
import { buildProfileLocations, type EditionInfo, type PowerShellInventory, type PowerShellPreferences, type ProfileRow } from './profiles';
import { discoverPowerShell, documentsDirectory, isPowerShellHome, probeInstallation, userProfileDirectory } from './discovery';
import { inspectProfile } from './files';

type ProbeResult = {home: string; userDirectory: string};
type ProbeOutcome = {result: ProbeResult} | {error: unknown};
export interface PowerShellRefresh {
  initial: PowerShellInventory;
  settled: Promise<PowerShellInventory | undefined>;
}

const passivePreferences: PowerShellPreferences = {
  allowRuntimeDiscovery: false,
  includeWindowsPowerShell: true,
};

function cloneEditions(editions: readonly EditionInfo[]): EditionInfo[] {
  return editions.map(edition => ({
    ...edition,
    installations: edition.installations.map(installation => ({...installation})),
  }));
}

export class PowerShellService {
  private outcomes = new Map<string, ProbeOutcome>();
  private inFlight = new Map<string, Promise<ProbeOutcome>>();
  private registryDocuments?: Promise<string | undefined>;
  private generation = 0;
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
    const effective = typeof preferences === 'boolean'
      ? {...passivePreferences, includeWindowsPowerShell: preferences}
      : preferences;
    if (retryFailures) {
      for (const [executable, outcome] of this.outcomes) if ('error' in outcome) this.outcomes.delete(executable);
      this.registryDocuments = undefined;
    }
    const generation = ++this.generation;
    const discovered = await this.discover(effective.includeWindowsPowerShell);
    const initialEditions = cloneEditions(discovered);
    await this.applyCached(initialEditions);
    let needsSettlement = false;
    for (const edition of initialEditions) {
      if (edition.installations.length && (!edition.userDirectory || edition.installations.some(item => !item.home))) {
        needsSettlement = true;
        edition.resolving = true;
      }
    }
    const initial = await this.compose(initialEditions);
    if (generation === this.generation) this.current = initial;

    if (!needsSettlement) return {initial, settled:Promise.resolve(undefined)};
    const working = cloneEditions(initialEditions);
    const settled = this.settle(generation, working, effective);
    return {initial, settled};
  }

  get snapshot(): PowerShellInventory { return this.current; }
  row(id: string): ProfileRow | undefined { return this.current.rows.find(row => row.id === id); }

  async resolve(installationId: string, preferences: PowerShellPreferences): Promise<void> {
    if (!preferences.allowRuntimeDiscovery) throw new Error('Runtime discovery is off');
    for (const edition of this.current.editions) {
      if (!preferences.includeWindowsPowerShell && edition.edition === 'Windows PowerShell') continue;
      const installation = edition.installations.find(item => item.id === installationId);
      if (!installation) continue;
      this.outcomes.delete(installation.executable);
      try {
        const result = await this.probe(installation, edition.edition);
        this.outcomes.set(installation.executable, {result});
        return;
      } catch (error) {
        this.outcomes.set(installation.executable, {error});
        throw error;
      }
    }
    throw new Error('Installation is no longer available; refresh first');
  }

  private async settle(
    generation: number,
    editions: EditionInfo[],
    preferences: PowerShellPreferences,
  ): Promise<PowerShellInventory | undefined> {
    await Promise.all(editions.map(edition => this.resolveEdition(edition, preferences.allowRuntimeDiscovery)));
    const inventory = await this.compose(editions);
    if (generation !== this.generation) return undefined;
    this.current = inventory;
    return inventory;
  }

  private async resolveEdition(edition: EditionInfo, allowRuntime: boolean): Promise<void> {
    try {
      const directories = new Set<string>();
      if (edition.userDirectory) directories.add(this.directoryKey(edition.userDirectory));

      if (allowRuntime && !edition.userDirectory) {
        // A failed preferred installation must not hide a viable alternative in the same edition.
        for (const installation of edition.installations) {
          const outcome = await this.probeCached(installation, edition);
          if ('error' in outcome) continue;
          installation.home ??= outcome.result.home;
          directories.add(this.directoryKey(outcome.result.userDirectory));
          edition.userDirectory ??= outcome.result.userDirectory;
          break;
        }
      }

      if (allowRuntime) {
        // Once the edition directory is known, only unresolved installation homes need a process.
        const unresolved = edition.installations.filter(installation => !installation.home);
        await this.mapLimit(unresolved, 2, async installation => {
          const outcome = await this.probeCached(installation, edition);
          if ('error' in outcome) return;
          installation.home = outcome.result.home;
          directories.add(this.directoryKey(outcome.result.userDirectory));
        });
      }

      // Cached successes on installations skipped above still participate in disagreement checks.
      for (const installation of edition.installations) {
        const outcome = this.outcomes.get(installation.executable);
        if (outcome && 'result' in outcome) {
          installation.home ??= outcome.result.home;
          directories.add(this.directoryKey(outcome.result.userDirectory));
          edition.userDirectory ??= outcome.result.userDirectory;
        }
      }

      if (directories.size > 1) {
        edition.userDirectory = undefined;
        edition.reason = 'PowerShell installations disagree on the current-user profile location.';
        return;
      }
      if (!edition.userDirectory && this.platform === 'win32' && edition.installations.length) {
        const documents = await this.registryFallback();
        edition.userDirectory = userProfileDirectory(this.platform, edition.edition, process.env, '', documents);
      }
      if (!edition.userDirectory && edition.installations.length) {
        edition.reason = 'Profile location unresolved after PowerShell and registry checks.';
      }
    } finally {
      edition.resolving = false;
    }
  }

  private async applyCached(editions: EditionInfo[]): Promise<void> {
    for (const edition of editions) {
      const directories = new Map<string, string>();
      if (edition.userDirectory) directories.set(this.directoryKey(edition.userDirectory), edition.userDirectory);
      for (const installation of edition.installations) {
        const outcome = this.outcomes.get(installation.executable);
        if (!outcome || 'error' in outcome) continue;
        if (!installation.home && !await this.holdsPowerShell(outcome.result.home)) {
          this.outcomes.delete(installation.executable);
          continue;
        }
        installation.home ??= outcome.result.home;
        directories.set(this.directoryKey(outcome.result.userDirectory), outcome.result.userDirectory);
      }
      if (directories.size === 1) edition.userDirectory = directories.values().next().value;
      else if (directories.size > 1) {
        edition.userDirectory = undefined;
        edition.reason = 'PowerShell installations disagree on the current-user profile location.';
      }
    }
  }

  private probeCached(installation: EditionInfo['installations'][number], edition: EditionInfo): Promise<ProbeOutcome> {
    const cached = this.outcomes.get(installation.executable);
    if (cached) return Promise.resolve(cached);
    const running = this.inFlight.get(installation.executable);
    if (running) return running;
    const promise: Promise<ProbeOutcome> = this.probe(installation, edition.edition).then(
      (result): ProbeOutcome => ({result}),
      (error): ProbeOutcome => ({error}),
    ).then(outcome => {
      this.outcomes.set(installation.executable, outcome);
      return outcome;
    }).finally(() => {
      if (this.inFlight.get(installation.executable) === promise) this.inFlight.delete(installation.executable);
    });
    this.inFlight.set(installation.executable, promise);
    return promise;
  }

  private registryFallback(): Promise<string | undefined> {
    this.registryDocuments ??= this.readDocuments().catch(() => undefined);
    return this.registryDocuments;
  }

  private async compose(editions: EditionInfo[]): Promise<PowerShellInventory> {
    const rows = await Promise.all(buildProfileLocations(this.platform, editions).map(inspectProfile));
    return {editions, rows};
  }

  private directoryKey(value: string): string {
    const paths = this.platform === 'win32' ? path.win32 : path.posix;
    const normalized = paths.normalize(value);
    return this.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  private async mapLimit<T>(values: readonly T[], limit: number, action: (value:T) => Promise<void>): Promise<void> {
    let index = 0;
    const worker = async () => {
      while (index < values.length) {
        const value = values[index++];
        if (value !== undefined) await action(value);
      }
    };
    await Promise.all(Array.from({length:Math.min(limit, values.length)}, worker));
  }
}
