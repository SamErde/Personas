import { join } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { asError } from './errors';
import { parsePackageMeta, type PackageMeta } from './parsers';

type ReadFile = (path: string) => Promise<string | undefined | Error>;
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

function message(bundle: NlsBundle, key: string): string | undefined {
  const value = bundle[key];
  if (typeof value === 'string') return value || undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)['message'];
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined;
}

/** Reads package metadata and resolves an exact displayName placeholder like VS Code's scanner. */
export async function readLocalizedPackageMeta(
  folder: string,
  language: string,
  readFile: ReadFile,
): Promise<PackageMeta | undefined | Error> {
  const packageText = await readFile(join(folder, 'package.json'));
  if (packageText === undefined || packageText instanceof Error) return packageText;

  let meta: PackageMeta;
  try {
    meta = parsePackageMeta(packageText);
  } catch (error) {
    return asError(error);
  }
  if (meta.displayNameKey === undefined) return meta;

  // VS Code only attempts a locale bundle when the extension has a usable default bundle.
  const defaultText = await readFile(join(folder, 'package.nls.json'));
  if (defaultText === undefined || defaultText instanceof Error) return meta;
  const defaultBundle = parseBundle(defaultText);
  if (!defaultBundle) return meta;

  let localeBundle: NlsBundle | undefined;
  for (const fileName of packageNlsLocaleFileNames(language)) {
    const localizedText = await readFile(join(folder, fileName));
    if (localizedText === undefined) continue;
    // The first present locale candidate wins. A read or parse failure falls directly back
    // to the default bundle rather than continuing to a less-specific locale.
    if (!(localizedText instanceof Error)) localeBundle = parseBundle(localizedText);
    break;
  }

  const localized = localeBundle ? message(localeBundle, meta.displayNameKey) : undefined;
  const fallback = message(defaultBundle, meta.displayNameKey);
  const displayName = localized ?? fallback;
  return displayName === undefined ? meta : { ...meta, displayName };
}
