import { buildProfileLocations, type PowerShellInventory, type PowerShellPreferences, type ProfileRow } from './profiles';
import { discoverPowerShell, isPowerShellHome, probeInstallation } from './discovery';
import { inspectProfile } from './files';

export class PowerShellService {
  private cached = new Map<string, {home: string; userDirectory: string}>();
  private current: PowerShellInventory = { editions: [], rows: [] };
  constructor(
    private readonly discover = (includeWindowsPowerShell: boolean) => discoverPowerShell(undefined, includeWindowsPowerShell),
    private readonly probe = probeInstallation,
    private readonly platform = process.platform,
    private readonly holdsPowerShell = isPowerShellHome,
  ) {}
  async refresh(includeWindowsPowerShell = true): Promise<PowerShellInventory> {
    const editions = await this.discover(includeWindowsPowerShell);
    for (const edition of editions) {
      for (const installation of edition.installations) {
        let result = this.cached.get(installation.executable);
        // An update can replace the home behind an unchanged launcher, such as a .NET tool shim.
        // A cached home that is gone is forgotten, so the installation can be resolved again.
        if (result && !installation.home && !await this.holdsPowerShell(result.home)) {
          this.cached.delete(installation.executable);
          result = undefined;
        }
        if (result) {
          // Authoritative passive results always win over the cached fallback. A Microsoft Store
          // update, for example, moves the home while the launcher that keys the cache stays the same.
          installation.home ??= result.home;
          edition.userDirectory ??= result.userDirectory;
        }
      }
      if (edition.userDirectory && edition.reason?.startsWith('Documents location unresolved')) edition.reason = undefined;
    }
    const rows = await Promise.all(buildProfileLocations(this.platform, editions).map(inspectProfile));
    this.current = { editions, rows };
    return this.current;
  }
  get snapshot(): PowerShellInventory { return this.current; }
  row(id: string): ProfileRow | undefined { return this.current.rows.find(row => row.id === id); }
  async resolve(installationId: string, preferences: PowerShellPreferences): Promise<void> {
    if (!preferences.allowRuntimeDiscovery) throw new Error('Runtime discovery is off');
    for (const edition of this.current.editions) {
      if (!preferences.includeWindowsPowerShell && edition.edition === 'Windows PowerShell') continue;
      const installation = edition.installations.find(i => i.id === installationId);
      if (!installation) continue;
      if (edition.userDirectory && installation.home) return;
      const result = await this.probe(installation, edition.edition);
      this.cached.set(installation.executable, result);
      return;
    }
    throw new Error('Installation is no longer available; refresh first');
  }
}
