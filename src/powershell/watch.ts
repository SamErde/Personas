import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Paths whose replacement can change the file reached, including directory links.
 * Resolve one component at a time so ".." in link text follows filesystem semantics.
 * Keep missing destinations so their nearest existing parent can be watched.
 */
export async function profileDependencies(file: string): Promise<string[]> {
  const dependencies = new Set([file]);
  let current = path.parse(file).root;
  const parts = (text: string) => text.split(process.platform === 'win32' ? /[\\/]/ : /\//).filter(Boolean);
  let remaining = parts(file.slice(current.length));
  let hops = 0;
  const visited = new Set<string>();
  while (remaining.length) {
    const part = remaining.shift()!;
    if (part === '.') continue;
    if (part === '..') {
      dependencies.add(current); // Removing this traversed directory also breaks resolution.
      current = path.dirname(current);
      continue;
    }
    const candidate = path.join(current, part);
    try {
      const stat = await fs.lstat(candidate);
      if (!stat.isSymbolicLink()) { current = candidate; continue; }
      dependencies.add(candidate);
      // A repeated link is only a cycle if the unresolved suffix is also identical.
      const key = JSON.stringify([candidate, remaining]);
      if (visited.has(key) || ++hops > 40) break;
      visited.add(key);
      const link = await fs.readlink(candidate);
      if (path.isAbsolute(link)) current = path.parse(link).root;
      const text = path.isAbsolute(link) ? link.slice(current.length) : link;
      remaining = [...parts(text), ...remaining];
    } catch {
      // Even missing/../target cannot resolve until missing exists.
      dependencies.add(candidate);
      dependencies.add(path.resolve(candidate, ...remaining));
      return [...dependencies];
    }
  }
  dependencies.add(current);
  return [...dependencies];
}

export async function profileWatchPlan(files: string[]): Promise<{paths:string[]; directories:string[]}> {
  const paths = new Set<string>();
  for (const file of files) for (const dependency of await profileDependencies(file)) paths.add(dependency);
  const directories = new Set<string>();
  for (const file of [...paths]) {
    let directory = path.dirname(file);
    while (true) {
      try {
        if ((await fs.stat(directory)).isDirectory()) {
          const canonical = await fs.realpath(directory);
          directories.add(canonical);
          // A nonrecursive watch inside a directory misses replacement of that directory itself.
          directories.add(path.dirname(canonical));
          // Watcher events use canonical directory names (including Windows 8.3 aliases).
          paths.add(path.join(canonical, path.relative(directory, file)));
          break;
        }
      } catch { /* A missing or inaccessible parent needs a watch farther up. */ }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return {paths:[...paths], directories:[...directories]};
}

export function affectsProfile(changed: string, dependencies: readonly string[]): boolean {
  // Deleted paths cannot be inspected for volume case sensitivity. Extra refreshes on
  // case-sensitive macOS volumes are preferable to missing events on insensitive ones.
  const ignoreCase = process.platform === 'win32' || process.platform === 'darwin';
  const normalize = (file:string) => ignoreCase ? path.resolve(file).toLowerCase() : path.resolve(file);
  const source = normalize(changed);
  return dependencies.some(file => {
    const relative = path.relative(source, normalize(file));
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
  });
}
