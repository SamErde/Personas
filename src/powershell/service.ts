import { buildProfileLocations, type EditionInfo, type PowerShellInventory, type ProfileRow } from './profiles';
import { discoverPowerShell, probeInstallation } from './discovery';
import { inspectProfile } from './files';

export class PowerShellService {
  private cached = new Map<string, {home: string; userDirectory: string}>();
  private current: PowerShellInventory = { editions: [], rows: [] };
  constructor(
    private readonly discover = discoverPowerShell,
    private readonly probe = probeInstallation,
    private readonly platform = process.platform,
  ) {}
  async refresh(): Promise<PowerShellInventory> {
    const editions = await this.discover();
    for (const edition of editions) {
      for (const installation of edition.installations) {
        const result = this.cached.get(installation.executable);
        if (result) {
          installation.home = result.home;
          // An authoritative passive user directory always wins over cached fallback.
          edition.userDirectory ??= result.userDirectory;
        }
      }
      if (edition.userDirectory && edition.installations.length) edition.reason = undefined;
    }
    const rows = await Promise.all(buildProfileLocations(this.platform, editions).map(inspectProfile));
    this.current = { editions, rows };
    return this.current;
  }
  get snapshot(): PowerShellInventory { return this.current; }
  row(id: string): ProfileRow | undefined { return this.current.rows.find(row => row.id === id); }
  async resolve(installationId: string): Promise<void> {
    for (const edition of this.current.editions) {
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
