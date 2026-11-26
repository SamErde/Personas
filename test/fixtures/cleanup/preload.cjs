// Runs only in the temporary cleanup CLI subprocess spawned by clean.test.ts.
const fs = require('node:fs');
const path = require('node:path');
const options = JSON.parse(process.env.CLEAN_TEST_OPTIONS);

// fchdir changes the kernel cwd directly on POSIX. Resolve fixture paths against it.
const absolute = (location) => path.resolve(fs.realpathSync.native('.'), location);

globalThis.fetch = async () => {
  if (options.fault === 'timeout') throw new Error('simulated timeout');
  if (options.fault === 'http-error') return { ok: false, status: 503 };
  return { ok: true, json: async () => options.response ?? ['1.110.0'] };
};

function failAtFixturePath(original) {
  return (location, ...args) => {
    if (absolute(location) === options.faultPath) throw new Error(`simulated ${options.fault}`);
    return original(location, ...args);
  };
}
if (options.fault === 'marker-error') fs.lstatSync = failAtFixturePath(fs.lstatSync);
if (options.fault === 'scan-error') fs.readdirSync = failAtFixturePath(fs.readdirSync);
if (options.fault === 'remove-error') fs.rmdirSync = failAtFixturePath(fs.rmdirSync);
if (options.fault === 'changed-directory') {
  const lstat = fs.lstatSync;
  let observed = false;
  fs.lstatSync = (location, ...args) => {
    const stat = lstat(location, ...args);
    if (absolute(location) === options.faultPath && !observed) {
      // The identity captured before opening differs from the actual held directory.
      stat.ino += 1n;
      observed = true;
    }
    return stat;
  };
}

// Rotate two ordinary, test-owned directories at the actual list/unlink boundary.
// POSIX permits renaming a held directory. A Windows deny-delete handle prevents it.
function rotateBefore(operation) {
  return (location, ...args) => {
    if (absolute(location) === options.faultPath) {
      const root = path.dirname(options.cache);
      try {
        fs.renameSync(options.cache, path.join(root, 'original'));
        fs.renameSync(path.join(root, 'replacement'), options.cache);
        console.error('rotation completed');
      } catch (error) {
        if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        console.error('rotation blocked');
      }
    }
    return operation(location, ...args);
  };
}
if (options.fault === 'rotate-at-list') fs.readdirSync = rotateBefore(fs.readdirSync);
if (options.fault === 'rotate-at-unlink') fs.unlinkSync = rotateBefore(fs.unlinkSync);
