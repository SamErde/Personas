import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listBoundedWorkspaceEntries, readBoundedWorkspaceManifest } from '../../src/workspaceFileIo';

const temporaryRoots: string[] = [];

async function candidatePath(): Promise<{ root: string; manifest: string }> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'personas-workspace-file-'));
  temporaryRoots.push(temporaryRoot);
  const root = join(temporaryRoot, 'extensions');
  const candidate = join(root, 'candidate');
  await mkdir(candidate, { recursive: true });
  return { root, manifest: join(candidate, 'package.json') };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('listBoundedWorkspaceEntries', () => {
  it('reads at most the cap plus one entry and closes the directory', async () => {
    const source = ['one', 'two', 'three', 'four'];
    let reads = 0;
    let closed = false;
    const result = await listBoundedWorkspaceEntries('workspace-controlled', 2, async () => ({
      read: async () => {
        const name = source[reads];
        reads += 1;
        return name ? { name, isDirectory: () => true } : null;
      },
      close: async () => {
        closed = true;
      },
    }));

    expect(result).toEqual([
      { name: 'one', isDirectory: true },
      { name: 'two', isDirectory: true },
      { name: 'three', isDirectory: true },
    ]);
    expect(reads).toBe(3);
    expect(closed).toBe(true);
  });
});

describe('readBoundedWorkspaceManifest', () => {
  it('reads a regular contained manifest and distinguishes a missing file', async () => {
    const paths = await candidatePath();
    await writeFile(paths.manifest, '{"publisher":"pub","name":"ext"}', 'utf8');
    expect(await readBoundedWorkspaceManifest(paths.manifest, paths.root, 1024)).toBe(
      '{"publisher":"pub","name":"ext"}',
    );
    expect(await readBoundedWorkspaceManifest(join(paths.root, 'missing', 'package.json'), paths.root, 1024))
      .toBeUndefined();
  });

  it('rejects a regular file larger than the byte ceiling', async () => {
    const paths = await candidatePath();
    await writeFile(paths.manifest, 'x'.repeat(33), 'utf8');
    const result = await readBoundedWorkspaceManifest(paths.manifest, paths.root, 32);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('exceeds 32 bytes');
  });

  it('rejects a non-regular manifest path', async () => {
    const paths = await candidatePath();
    await mkdir(paths.manifest);
    const result = await readBoundedWorkspaceManifest(paths.manifest, paths.root, 1024);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('not a regular file');
  });

  it.skipIf(process.platform === 'win32')('rejects a manifest symlink, including one escaping the root', async () => {
    const paths = await candidatePath();
    const outside = join(temporaryRoots[temporaryRoots.length - 1] as string, 'outside.json');
    await writeFile(outside, '{"publisher":"pub","name":"outside"}', 'utf8');
    await symlink(outside, paths.manifest);
    const result = await readBoundedWorkspaceManifest(paths.manifest, paths.root, 1024);
    expect(result).toBeInstanceOf(Error);
  });
});
