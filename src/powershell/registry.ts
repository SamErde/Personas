import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Decode only BOM-marked Unicode exports, never the console's current code page. */
export function registryExportPersonal(bytes: Buffer, key: string, env: NodeJS.ProcessEnv): string | undefined {
  if (bytes.length > 256 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xfe || bytes.length % 2) return undefined;
  let text: string;
  try { text = new TextDecoder('utf-16le', {fatal:true}).decode(bytes); } catch { return undefined; }
  const lines = text.replace(/\\\r?\n\s*/g, '').split(/\r?\n/);
  let inKey = false;
  for (const line of lines) {
    if (line.startsWith('[')) { inKey = line.toLowerCase() === '[' + key.toLowerCase() + ']'; continue; }
    if (!inKey || !line.startsWith('"Personal"=')) continue;
    const encoded = line.slice('"Personal"='.length);
    let value: string;
    if (/^"(?:[^"\\]|\\["\\])*"$/.test(encoded)) {
      value = encoded.slice(1,-1).replace(/\\(["\\])/g, '$1');
    } else if (/^hex\(2\):(?:[0-9a-f]{2},)*[0-9a-f]{2}$/i.test(encoded)) {
      const data = Buffer.from(encoded.slice(7).split(',').map(part => parseInt(part,16)));
      if (data.length % 2 || data.at(-1) !== 0 || data.at(-2) !== 0) return undefined;
      try { value = new TextDecoder('utf-16le', {fatal:true}).decode(data.subarray(0,-2)); } catch { return undefined; }
      value = value.replace(/%([^%]+)%/g, (match, key: string) =>
        Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1] ?? match);
      if (/%[^%]+%/.test(value)) return undefined;
    } else return undefined;
    return path.win32.isAbsolute(value) && !/[\0\r\n\uFFFD?]/.test(value) ? value : undefined;
  }
  return undefined;
}

export async function readRegistryDocuments(
  registry: string, run: (exe: string, args: string[]) => Promise<string>, env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'personas-registry-'));
  try {
    const values: (string | undefined)[] = [];
    for (const folder of ['User Shell Folders', 'Shell Folders']) {
      const key = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\' + folder;
      const file = path.join(temporary, folder + '.reg');
      await run(registry, ['export', key, file, '/y']);
      values.push(registryExportPersonal(await fs.readFile(file), key, env));
    }
    const [configured, effective] = values;
    return configured && effective && directoryKey(configured) === directoryKey(effective)
      ? effective : undefined;
  } finally { await fs.rm(temporary, {recursive:true, force:true}); }
}

function directoryKey(value: string): string {
  const normalized = path.win32.normalize(value).toLowerCase();
  const root = path.win32.parse(normalized).root;
  return normalized.length > root.length ? normalized.replace(/[\\\\]+$/, '') : normalized;
}
