import * as path from 'node:path';

export function run(): Promise<void> {
  // node:test's run({ files }) always forks a fresh child process per file — verified locally,
  // even a single-file run gets a distinct pid and a fresh module registry. That's incompatible
  // with this suite: inventory.test.ts does `require('vscode')`, which only resolves inside the
  // sandboxed Extension Development Host process itself (VS Code patches module resolution there
  // at startup); a forked child has none of that and fails with MODULE_NOT_FOUND. So instead of
  // run(), require the compiled suite in-process — this registers its tests with node:test's
  // implicit root harness, which executes them here — and await the completion signal it exports.
  const suite = require(path.resolve(__dirname, 'inventory.test.js')) as { done: Promise<boolean> };
  return suite.done.then((failed) => {
    if (failed) {
      throw new Error('integration test(s) failed');
    }
  });
}
