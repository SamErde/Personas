import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import type { Edition, EditionInfo, Installation } from './profiles';

export function userProfileDirectory(
  platform: string, edition: Edition, env: NodeJS.ProcessEnv, home: string, documents?: string,
): string | undefined {
  if (platform === 'win32') return documents && path.win32.isAbsolute(documents)
    ? path.win32.join(documents, edition === 'Windows PowerShell' ? 'WindowsPowerShell' : 'PowerShell') : undefined;
  const base = env.XDG_CONFIG_HOME || (home ? path.posix.join(home, '.config') : '');
  return base && path.posix.isAbsolute(base) ? path.posix.join(base, 'powershell') : undefined;
}

export function runFile(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(executable, args, {
    timeout: 5000, maxBuffer: 128 * 1024, windowsHide: true, encoding: 'utf8',
  }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

export function registryPersonal(output: string, env: NodeJS.ProcessEnv): string | undefined {
  const raw = /^\s*Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)$/mi.exec(output)?.[1]?.trim();
  if (!raw) return undefined;
  const expanded = raw.replace(/%([^%]+)%/g, (match, key: string) =>
    Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1] ?? match);
  return !expanded.includes('%') && path.win32.isAbsolute(expanded) ? expanded : undefined;
}

/** Read both configured and shell-resolved Documents; disagreement requires explicit resolution.
 * reg.exe is a bounded OS metadata query, never a PowerShell launch.
 */
async function documentsDirectory(): Promise<string | undefined> {
  const root = process.env.SystemRoot;
  if (!root || !path.win32.isAbsolute(root)) return undefined;
  const registry = path.win32.join(root, 'System32', 'reg.exe');
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\';
  try {
    const results = await Promise.all(['User Shell Folders', 'Shell Folders'].map(async folder =>
      registryPersonal(await runFile(registry, ['query', key + folder, '/v', 'Personal']), process.env)));
    const [configured, effective] = results;
    return configured && effective && path.win32.normalize(configured).toLowerCase() === path.win32.normalize(effective).toLowerCase()
      ? effective : undefined;
  } catch { return undefined; }
}

type DiscoveryIo = Pick<typeof fs, 'stat' | 'readdir' | 'realpath'>;
function reportDiscoveryError(file: string, error: unknown, errors: string[]): void {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== 'ENOENT' && code !== 'ENOTDIR') errors.push(file + ': ' + String(error));
}
async function exists(file: string, io: DiscoveryIo, errors: string[]): Promise<boolean> {
  try { return (await io.stat(file)).isFile(); }
  catch (error) { reportDiscoveryError(file, error, errors); return false; }
}

export async function discoverPowerShell(io: DiscoveryIo = fs): Promise<EditionInfo[]> {
  const errorsByEdition = new Map<Edition, string[]>();
  const errorsFor = (edition: Edition): string[] => {
    let errors = errorsByEdition.get(edition);
    if (!errors) { errors = []; errorsByEdition.set(edition, errors); }
    return errors;
  };
  const platform = process.platform;
  const home = process.env.HOME || (platform === 'win32' ? os.homedir() : '');
  const documents = platform === 'win32' ? await documentsDirectory() : undefined;
  const candidates: { edition: Edition; executable: string }[] = [];
  const add = (executable: string, edition: Edition = 'PowerShell 7') => candidates.push({ edition, executable });
  if (platform === 'win32') {
    for (const base of new Set([process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((v): v is string => !!v))) {
      const directory = path.join(base, 'PowerShell');
      const children = await io.readdir(directory).catch(error => {reportDiscoveryError(directory, error, errorsFor('PowerShell 7')); return [];});
      for (const child of children.filter(c => /^7(?:\.\d+)*$/.test(c))) add(path.join(directory, child, 'pwsh.exe'));
    }
    if (process.env.SystemRoot) {
      for (const system of ['System32', 'SysWOW64']) add(
        path.join(process.env.SystemRoot, system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'Windows PowerShell');
    }
    if (process.env.LOCALAPPDATA) add(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pwsh.exe'));
    if (home) add(path.join(home, '.dotnet', 'tools', 'pwsh.exe'));
  } else {
    for (const executable of [
      '/usr/local/microsoft/powershell/7/pwsh', '/opt/microsoft/powershell/7/pwsh',
      '/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh', '/usr/bin/pwsh',
      '/snap/powershell/current/opt/powershell/pwsh',
      ...(home ? [path.join(home, '.dotnet', 'tools', 'pwsh')] : []),
    ]) add(executable);
  }
  const found = new Map<Edition, Installation[]>();
  for (const candidate of candidates) {
    const errors = errorsFor(candidate.edition);
    if (!await exists(candidate.executable, io, errors)) continue;
    const actual = await io.realpath(candidate.executable).catch(() => candidate.executable);
    // Preview links must not accidentally bring Preview into the initial scope.
    if (/preview/i.test(actual)) continue;
    const directory = path.dirname(actual);
    const psHome = await exists(path.join(directory, 'System.Management.Automation.dll'), io, errors) ? directory : undefined;
    const installation: Installation = {
      id: psHome ?? actual, executable: actual, home: psHome,
      readOnly: /[\\/]WindowsApps[\\/]/i.test(actual),
    };
    const installs = found.get(candidate.edition) ?? [];
    if (!installs.some(i => i.id.toLowerCase() === installation.id.toLowerCase() && platform === 'win32' || i.id === installation.id)) installs.push(installation);
    found.set(candidate.edition, installs);
  }
  const editions: Edition[] = platform === 'win32' ? ['PowerShell 7', 'Windows PowerShell'] : ['PowerShell 7'];
  return editions.map(edition => {
    const errors = errorsFor(edition);
    const installations = found.get(edition) ?? [];
    return {
      edition, installations,
      userDirectory: installations.length ? userProfileDirectory(platform, edition, process.env, home, documents) : undefined,
      reason: errors.length ? errors.join('; ') : !installations.length ? 'Installation not found'
        : platform === 'win32' && !documents ? 'Documents location unresolved. Use Resolve Using PowerShell….' : undefined,
    };
  });
}

/** Only the explicit UI action calls this function. No profile scripts or policy changes. */
export async function probeInstallation(installation: Installation, edition: Edition): Promise<{ home: string; userDirectory: string }> {
  const command = '[pscustomobject]@{home=$PSHOME;user=$PROFILE.CurrentUserAllHosts;major=$PSVersionTable.PSVersion.Major;preview=$PSVersionTable.PSVersion.PreReleaseLabel}|ConvertTo-Json -Compress';
  const output = await runFile(installation.executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]);
  const data: unknown = JSON.parse(output.replace(/^\uFEFF/, '').trim());
  if (!data || typeof data !== 'object') throw new Error('Invalid PowerShell discovery response');
  const value = data as Record<string, unknown>;
  if (typeof value.home !== 'string' || !path.isAbsolute(value.home) ||
      typeof value.user !== 'string' || !path.isAbsolute(value.user) ||
      value.major !== (edition === 'PowerShell 7' ? 7 : 5) || value.preview) {
    throw new Error('PowerShell returned unsupported or unresolved profile paths');
  }
  return { home: value.home, userDirectory: path.dirname(value.user) };
}
