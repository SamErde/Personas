import { join } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { asError } from './errors';
import { parsePackageMeta, type PackageMeta } from './parsers';

type ReadFile = (path: string) => Promise<string | undefined | Error>;
type JoinPath = (folder: string, fileName: string) => string;
type NlsBundle = Record<string, unknown>;

const MAX_LOCALE_LENGTH = 32;
const SAFE_LOCALE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/** Locale bundles in VS Code's most-specific-to-parent search order. */
export function packageNlsLocaleFileNames(language: string): string[] {
  if (language.length === 0 || language.length > MAX_LOCALE_LENGTH || !SAFE_LOCALE.test(language)) return [];
  const parts = language.toLowerCase().split('-');
  const names: string[] = [];
  while (parts.length > 0) {
    names.push(`package.nls.${parts.join('-')}.json`);
    parts.pop();
  }
  return names;
}

function parseBundle(text: string): NlsBundle | undefined {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  return errors.length === 0 && typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as NlsBundle)
    : undefined;
}

function message(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)['message'];
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined;
}

async function readParsedPackageMeta(folder: string, readFile: ReadFile): Promise<PackageMeta | undefined | Error> {
  const packageText = await readFile(join(folder, 'package.json'));
  if (packageText === undefined || packageText instanceof Error) return packageText;
  try {
    return parsePackageMeta(packageText);
  } catch (error) {
    return asError(error);
  }
}

async function readDefaultBundle(
  folder: string,
  readFile: ReadFile,
  joinPath: JoinPath,
): Promise<NlsBundle | undefined> {
  const text = await readFile(joinPath(folder, 'package.nls.json'));
  return typeof text === 'string' ? parseBundle(text) : undefined;
}

async function readLocaleBundle(
  folder: string,
  language: string,
  readFile: ReadFile,
  joinPath: JoinPath,
): Promise<NlsBundle | undefined> {
  for (const fileName of packageNlsLocaleFileNames(language)) {
    const text = await readFile(joinPath(folder, fileName));
    if (text === undefined) continue;
    // The first present locale candidate wins. A read or parse failure falls directly back
    // to the default bundle rather than continuing to a less-specific locale.
    return typeof text === 'string' ? parseBundle(text) : undefined;
  }
  return undefined;
}

/** Resolves a parsed package display name through extension-owned NLS bundles. */
export async function resolveLocalizedPackageDisplayName(
  meta: Pick<PackageMeta, 'displayName' | 'displayNameKey'>,
  folder: string,
  language: string,
  readFile: ReadFile,
  joinPath: JoinPath = join,
): Promise<string | undefined> {
  if (meta.displayNameKey === undefined) return meta.displayName;

  // VS Code only attempts a locale bundle when the extension has a usable default bundle.
  const defaultBundle = await readDefaultBundle(folder, readFile, joinPath);
  if (!defaultBundle) return undefined;

  const localeBundle = await readLocaleBundle(folder, language, readFile, joinPath);
  const localized = localeBundle?.[meta.displayNameKey];
  // Match VS Code's `translated === undefined` fallback: a present but empty locale value is
  // selected, then rejected, rather than being replaced with the nonempty default message.
  const selected = localized === undefined ? defaultBundle[meta.displayNameKey] : localized;
  return message(selected);
}

/** Reads package metadata and resolves an exact displayName placeholder like VS Code's scanner. */
export async function readLocalizedPackageMeta(
  folder: string,
  language: string,
  readFile: ReadFile,
): Promise<PackageMeta | undefined | Error> {
  const meta = await readParsedPackageMeta(folder, readFile);
  if (meta === undefined || meta instanceof Error) return meta;
  if (meta.displayNameKey === undefined) return meta;

  const displayName = await resolveLocalizedPackageDisplayName(meta, folder, language, readFile);
  return displayName === undefined ? meta : { ...meta, displayName };
}
