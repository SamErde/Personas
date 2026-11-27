import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  packageNlsLocaleFileNames,
  readLocalizedPackageMeta,
  resolveLocalizedPackageDisplayName,
} from '../../src/core/packageNls';
import type { PackageMeta } from '../../src/core/parsers';

const folder = join('extensions', 'pub.ext-1.0.0');
const packagePath = join(folder, 'package.json');
const basePath = join(folder, 'package.nls.json');
const packageJson = JSON.stringify({ name: 'ext', displayName: '%displayName%', description: '%description%' });

type FileValue = string | Error | undefined;

function reader(files: Record<string, FileValue>) {
  const calls: string[] = [];
  return {
    calls,
    readFile: async (path: string): Promise<FileValue> => {
      calls.push(path);
      return files[path];
    },
  };
}

function requireMeta(value: PackageMeta | undefined | Error): PackageMeta {
  expect(value).not.toBeInstanceOf(Error);
  expect(value).toBeDefined();
  if (value === undefined || value instanceof Error) throw new Error('Expected package metadata');
  return value;
}

describe('packageNlsLocaleFileNames', () => {
  it('returns most-specific to parent-locale filenames', () => {
    expect(packageNlsLocaleFileNames('zh-Hans-CN')).toEqual([
      'package.nls.zh-hans-cn.json',
      'package.nls.zh-hans.json',
      'package.nls.zh.json',
    ]);
  });

  it.each(['', '../en', 'en/', 'en-', 'a'.repeat(33)])('rejects an unsafe or invalid language (%s)', (language) => {
    expect(packageNlsLocaleFileNames(language)).toEqual([]);
  });
});

describe('resolveLocalizedPackageDisplayName', () => {
  it('returns a literal name without reading a bundle', async () => {
    const io = reader({ [basePath]: JSON.stringify({ displayName: 'Ignored' }) });

    const displayName = await resolveLocalizedPackageDisplayName(
      { displayName: 'Literal' },
      folder,
      'de',
      io.readFile,
    );

    expect(displayName).toBe('Literal');
    expect(io.calls).toEqual([]);
  });

  it('localizes already-parsed placeholder metadata without rereading package.json', async () => {
    const localePath = join(folder, 'package.nls.de.json');
    const io = reader({
      [basePath]: JSON.stringify({ displayName: 'English' }),
      [localePath]: JSON.stringify({ displayName: 'Deutsch' }),
    });

    const displayName = await resolveLocalizedPackageDisplayName(
      { displayNameKey: 'displayName' },
      folder,
      'de',
      io.readFile,
    );

    expect(displayName).toBe('Deutsch');
    expect(io.calls).toEqual([basePath, localePath]);
  });
});

describe('readLocalizedPackageMeta', () => {
  it('does not read package NLS files for a literal display name', async () => {
    const literalPackage = JSON.stringify({ name: 'ext', displayName: 'Literal', description: '%description%' });
    const io = reader({ [packagePath]: literalPackage, [basePath]: JSON.stringify({ displayName: 'Ignored' }) });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, 'de', io.readFile));
    expect(meta?.displayName).toBe('Literal');
    expect(meta?.description).toBeUndefined();
    expect(io.calls).toEqual([packagePath]);
  });

  it('walks locale parents until it finds a bundle, then resolves a string value', async () => {
    const zhPath = join(folder, 'package.nls.zh.json');
    const io = reader({
      [packagePath]: packageJson,
      [basePath]: JSON.stringify({ displayName: 'English' }),
      [zhPath]: JSON.stringify({ displayName: '中文' }),
    });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, 'zh-Hans-CN', io.readFile));
    expect(meta?.displayName).toBe('中文');
    expect(io.calls).toEqual([
      packagePath,
      basePath,
      join(folder, 'package.nls.zh-hans-cn.json'),
      join(folder, 'package.nls.zh-hans.json'),
      zhPath,
    ]);
  });

  it('accepts an object message from the exact locale', async () => {
    const localePath = join(folder, 'package.nls.de.json');
    const io = reader({
      [packagePath]: packageJson,
      [basePath]: JSON.stringify({ displayName: 'English' }),
      [localePath]: JSON.stringify({ displayName: { message: 'Deutsch', comment: ['Shown in the matrix'] } }),
    });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, 'de', io.readFile));
    expect(meta?.displayName).toBe('Deutsch');
  });

  it('accepts comments and trailing commas in VS Code NLS bundles', async () => {
    const localePath = join(folder, 'package.nls.de.json');
    const io = reader({
      [packagePath]: packageJson,
      [basePath]: '{ // default translation\n "displayName": "English",\n}',
      [localePath]: '{ /* active locale */ "displayName": "Deutsch", }',
    });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, 'de', io.readFile));

    expect(meta.displayName).toBe('Deutsch');
  });

  it('falls back by key to the default bundle', async () => {
    const localePath = join(folder, 'package.nls.fr.json');
    const io = reader({
      [packagePath]: packageJson,
      [basePath]: JSON.stringify({ displayName: { message: 'English' } }),
      [localePath]: JSON.stringify({ anotherKey: 'Autre' }),
    });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, 'fr', io.readFile));
    expect(meta?.displayName).toBe('English');
  });

  it.each([
    ['empty string', ''],
    ['empty object message', { message: '' }],
  ])('does not replace a present locale %s with the default message', async (_name, localized) => {
    const localePath = join(folder, 'package.nls.fr.json');
    const io = reader({
      [packagePath]: packageJson,
      [basePath]: JSON.stringify({ displayName: 'English' }),
      [localePath]: JSON.stringify({ displayName: localized }),
    });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, 'fr', io.readFile));

    expect(meta.displayName).toBeUndefined();
  });

  it.each([
    ['unreadable', new Error('denied')],
    ['malformed', '{'],
    ['non-object', '[]'],
  ])('falls directly to the default bundle when the selected locale is %s', async (_name, locale) => {
    const exactPath = join(folder, 'package.nls.zh-hans.json');
    const parentPath = join(folder, 'package.nls.zh.json');
    const io = reader({
      [packagePath]: packageJson,
      [basePath]: JSON.stringify({ displayName: 'English' }),
      [exactPath]: locale as string | Error,
      [parentPath]: JSON.stringify({ displayName: 'Should not be read' }),
    });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, 'zh-Hans', io.readFile));
    expect(meta?.displayName).toBe('English');
    expect(io.calls).not.toContain(parentPath);
  });

  it.each([
    ['missing', undefined],
    ['unreadable', new Error('denied')],
    ['malformed', '{'],
    ['non-object', '[]'],
  ])('does not use a valid locale bundle when the default bundle is %s', async (_name, base) => {
    const localePath = join(folder, 'package.nls.de.json');
    const io = reader({
      [packagePath]: packageJson,
      [basePath]: base as FileValue,
      [localePath]: JSON.stringify({ displayName: 'Deutsch' }),
    });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, 'de', io.readFile));
    expect(meta?.displayName).toBeUndefined();
    expect(io.calls).toEqual([packagePath, basePath]);
  });

  it.each([
    ['empty string', JSON.stringify({ displayName: '' })],
    ['empty object message', JSON.stringify({ displayName: { message: '' } })],
    ['unsupported value', JSON.stringify({ displayName: 42 })],
  ])('keeps the extension-id fallback for an %s', async (_name, base) => {
    const io = reader({ [packagePath]: packageJson, [basePath]: base });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, '', io.readFile));
    expect(meta?.displayName).toBeUndefined();
  });

  it('uses only the default bundle for an invalid language', async () => {
    const io = reader({ [packagePath]: packageJson, [basePath]: JSON.stringify({ displayName: 'English' }) });

    const meta = requireMeta(await readLocalizedPackageMeta(folder, '../de', io.readFile));
    expect(meta?.displayName).toBe('English');
    expect(io.calls).toEqual([packagePath, basePath]);
  });
});
