import { readRegistryDocuments } from './registry';
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

export function runFile(executable: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => execFile(executable, args, {
    timeout: 5000, maxBuffer: 128 * 1024, windowsHide: true, encoding: 'buffer',
  }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

/** Read both configured and shell-resolved Documents; disagreement requires explicit resolution.
 * reg.exe exports BOM-marked Unicode metadata to a private temporary directory; it never launches PowerShell.
 */
export async function documentsDirectory(): Promise<string | undefined> {
  const root = process.env.SystemRoot;
  if (!root || !path.win32.isAbsolute(root)) return undefined;
  const registry = path.win32.join(root, 'System32', 'reg.exe');
  try { return await readRegistryDocuments(registry, runFile, process.env); }
  catch { return undefined; }
}

type DiscoveryIo = Pick<typeof fs, 'stat' | 'readdir' | 'realpath' | 'readlink'>;
function reportDiscoveryError(file: string, error: unknown, errors: string[]): void {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== 'ENOENT' && code !== 'ENOTDIR') errors.push(file + ': ' + String(error));
}
async function exists(file: string, io: DiscoveryIo, errors: string[]): Promise<boolean> {
  try { return (await io.stat(file)).isFile(); }
  catch (error) { reportDiscoveryError(file, error, errors); return false; }
}
/** The executable behind a candidate. A Microsoft Store installation is started through an app
 * execution alias, which stat cannot follow on Windows (EACCES) but readlink can.
 */
async function locate(file: string, platform: string, io: DiscoveryIo, errors: string[]): Promise<string | undefined> {
  try { return (await io.stat(file)).isFile() ? file : undefined; }
  catch (error) {
    if (platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EACCES') {
      const target = await io.readlink(file).catch(() => undefined);
      if (target && path.win32.isAbsolute(target) && await exists(target, io, [])) return target;
    }
    reportDiscoveryError(file, error, errors);
    return undefined;
  }
}

export async function discoverPowerShell(io: DiscoveryIo = fs, includeWindowsPowerShell = true): Promise<EditionInfo[]> {
  const errorsByEdition = new Map<Edition, string[]>();
  const errorsFor = (edition: Edition): string[] => {
    let errors = errorsByEdition.get(edition);
    if (!errors) { errors = []; errorsByEdition.set(edition, errors); }
    return errors;
  };
  const platform = process.platform;
  const home = platform === 'win32' ? os.homedir() : process.env.HOME || '';
  const candidates: { edition: Edition; executable: string }[] = [];
  const add = (executable: string, edition: Edition = 'PowerShell 7') => candidates.push({ edition, executable });
  if (platform === 'win32') {
    for (const base of new Set([process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((v): v is string => !!v))) {
      const directory = path.join(base, 'PowerShell');
      const children = await io.readdir(directory).catch(error => {reportDiscoveryError(directory, error, errorsFor('PowerShell 7')); return [];});
      for (const child of children.filter(c => /^7(?:\.\d+)*$/.test(c))) add(path.join(directory, child, 'pwsh.exe'));
    }
    if (includeWindowsPowerShell && process.env.SystemRoot) {
      for (const system of ['System32', 'SysWOW64']) add(
        path.join(process.env.SystemRoot, system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'Windows PowerShell');
    }
    if (process.env.LOCALAPPDATA) add(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pwsh.exe'));
    if (home) add(path.join(home, '.dotnet', 'tools', 'pwsh.exe'));
  } else {
    for (const executable of [
      '/usr/local/microsoft/powershell/7/pwsh', '/opt/microsoft/powershell/7/pwsh',
      '/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh', '/usr/bin/pwsh',
      '/usr/local/bin/pwsh-lts', '/opt/homebrew/bin/pwsh-lts',
      '/snap/powershell/current/opt/powershell/pwsh',
      ...(home ? [path.join(home, '.dotnet', 'tools', 'pwsh')] : []),
    ]) add(executable);
  }
  const found = new Map<Edition, Installation[]>();
  for (const candidate of candidates) {
    const errors = errorsFor(candidate.edition);
    const located = await locate(candidate.executable, platform, io, errors);
    if (!located) continue;
    const actual = await io.realpath(located).catch(() => located);
    // Preview links must not accidentally bring Preview into the initial scope.
    if (isPreviewInstallation(actual)) continue;
    const directory = path.dirname(actual);
    // The assembly check tells a real PowerShell 7 home from a shim. Windows PowerShell keeps that
    // assembly in the GAC, and its system executables always sit in their own $PSHOME.
    const psHome = candidate.edition === 'Windows PowerShell'
      || await exists(path.join(directory, 'System.Management.Automation.dll'), io, errors) ? directory : undefined;
    const installation: Installation = {
      // An alias stays the launcher: its target sits in a versioned package folder that every update replaces.
      id: psHome ?? actual, executable: located === candidate.executable ? actual : candidate.executable, home: psHome,
      readOnly: /[\\/]WindowsApps[\\/]/i.test(actual),
    };
    const installs = found.get(candidate.edition) ?? [];
    if (!installs.some(i => i.id.toLowerCase() === installation.id.toLowerCase() && platform === 'win32' || i.id === installation.id)) installs.push(installation);
    found.set(candidate.edition, installs);
  }
  const editions: Edition[] = platform === 'win32' && includeWindowsPowerShell ? ['PowerShell 7', 'Windows PowerShell'] : ['PowerShell 7'];
  return editions.map(edition => {
    const errors = errorsFor(edition);
    const installations = found.get(edition) ?? [];
    return {
      edition, installations,
      userDirectory: installations.length && platform !== 'win32'
        ? userProfileDirectory(platform, edition, process.env, home) : undefined,
      reason: errors.length ? errors.join('; ') : !installations.length ? 'Installation not found' : undefined,
    };
  });
}

/** Whether a directory still holds a PowerShell 7 installation: its engine assembly sits in $PSHOME. */
export async function isPowerShellHome(directory: string): Promise<boolean> {
  return fs.stat(path.join(directory, 'System.Management.Automation.dll')).then(stat => stat.isFile(), () => false);
}

/** Starts one detected installation without loading profiles. No profile scripts or policy changes. */
function fullyQualifiedWindowsPath(value: string): boolean {
  const root = path.win32.parse(value).root.replaceAll('/','\\');
  const first = root.charCodeAt(0) | 32;
  const drive = [root.length === 3, first >= 97, first <= 122, root[1] === ':', root[2] === '\\'].every(Boolean);
  const unc = [root.startsWith('\\\\'), root.indexOf('\\',2) > 2].every(Boolean);
  return [path.win32.isAbsolute(value), [drive,unc].some(Boolean)].every(Boolean);
}
const probePathDialects = [
  {isAbsolute:path.posix.isAbsolute, dirname:path.posix.dirname, questionMarkAllowed:true},
  {isAbsolute:fullyQualifiedWindowsPath, dirname:path.win32.dirname, questionMarkAllowed:false},
] as const;
export async function probeInstallation(installation: Installation, edition: Edition, run = runFile): Promise<{ home: string; userDirectory: string }> {
  const command = '[string]$PSHOME; [string]$PROFILE.CurrentUserAllHosts; [string]$PSVersionTable.PSVersion.Major; [string]$PSVersionTable.PSVersion.PreReleaseLabel';
  const bytes = await run(installation.executable, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'XML', '-Command', command,
  ]);
  const output = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  const [home, user, major, preview] = powerShellOutputStrings(output);
  const expectedMajor: Record<Edition, string> = {'PowerShell 7':'7', 'Windows PowerShell':'5'};
  const dialect = probePathDialects[Number(fullyQualifiedWindowsPath(installation.executable))]!;
  if (![
    dialect.isAbsolute(home), dialect.isAbsolute(user),
    !home.includes('\0'), !user.includes('\0'),
    [dialect.questionMarkAllowed,!home.includes('?')].some(Boolean),
    [dialect.questionMarkAllowed,!user.includes('?')].some(Boolean),
    major === expectedMajor[edition], !preview,
  ].every(Boolean)) {
    throw new Error('PowerShell returned unsupported or unresolved profile paths');
  }
  return { home, userDirectory: dialect.dirname(user) };
}

const maxProbeOutput = 64 * 1024;
const xmlEntity = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;
const xml10Characters = /^[\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]*$/u;
const namedXmlEntities: Record<string, string> = {
  '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'",
};
function decodeXmlEntity(entity: string): string {
  const named = namedXmlEntities[entity];
  if (named !== undefined) return named;
  const hexadecimal = entity[2]?.toLowerCase() === 'x';
  const codepoint = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
  const invalid = [
    !Number.isSafeInteger(codepoint), codepoint < 0, codepoint > 0x10ffff,
    codepoint >= 0xd800 && codepoint <= 0xdfff,
  ].some(Boolean);
  if (invalid) throw new Error('Invalid PowerShell discovery response');
  const character = String.fromCodePoint(codepoint);
  if (!xml10Characters.test(character)) throw new Error('Invalid PowerShell discovery response');
  return character;
}
function decodeXmlText(value: string): string {
  const invalid = [
    value.includes('<'), value.includes(']]>'), value.replace(xmlEntity, '').includes('&'),
    !xml10Characters.test(value),
  ].some(Boolean);
  if (invalid) throw new Error('Invalid PowerShell discovery response');
  const decoded = value.replace(xmlEntity, decodeXmlEntity);
  // PowerShell escapes UTF-16 code units as _xHHHH_. A single pass deliberately turns
  // _x005F_x0041_ back into the literal text _x0041_, rather than decoding it twice to A.
  return decoded.replace(/_x([0-9a-f]{4})_/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function powerShellOutputStrings(output: string): [string, string, string, string] {
  if (Buffer.byteLength(output, 'utf8') > maxProbeOutput) throw new Error('Invalid PowerShell discovery response');
  const document = /^#< CLIXML\r?\n<Objs Version="1\.1\.0\.1" xmlns="http:\/\/schemas\.microsoft\.com\/powershell\/2004\/04">([\s\S]*)<\/Objs>[ \t\r\n]*$/.exec(output);
  if (!document) throw new Error('Invalid PowerShell discovery response');
  const body = document[1]!;
  const values: string[] = [];
  const element = /<S S="Output">([\s\S]*?)<\/S>/g;
  let position = 0;
  for (let match = element.exec(body); match; match = element.exec(body)) {
    if (match.index !== position) throw new Error('Invalid PowerShell discovery response');
    values.push(decodeXmlText(match[1]!));
    position = element.lastIndex;
  }
  if (position !== body.length || values.length !== 4) throw new Error('Invalid PowerShell discovery response');
  return values as [string, string, string, string];
}

export function isPreviewInstallation(executable: string): boolean {
  const normalized = executable.replace(/\\/g, '/');
  return /(?:^|\/)powershell\/7(?:\.\d+)*(?:-preview[^/]*)\//i.test(normalized)
    || /(?:^|\/)Caskroom\/powershell-preview\//i.test(normalized)
    || /(?:^|\/)\.store\/powershell\/7\.\d+\.\d+-preview[^/]*\//i.test(normalized)
    || /(?:^|\/)WindowsApps\/Microsoft\.PowerShellPreview_/i.test(normalized);
}
