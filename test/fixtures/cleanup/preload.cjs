// Runs only in the temporary cleanup CLI subprocess spawned by clean.test.ts.
const fs = require('node:fs');
const options = JSON.parse(process.env.CLEAN_TEST_OPTIONS);

globalThis.fetch = async () => {
  if (options.fault === 'timeout') throw new Error('simulated timeout');
  if (options.fault === 'http-error') return { ok: false, status: 503 };
  return { ok: true, json: async () => options.response ?? ['1.110.0'] };
};

function failAtFixturePath(original) {
  return (location, ...args) => {
    if (location === options.faultPath) throw new Error(`simulated ${options.fault}`);
    return original(location, ...args);
  };
}
if (options.fault === 'marker-error') fs.lstatSync = failAtFixturePath(fs.lstatSync);
if (options.fault === 'scan-error') fs.readdirSync = failAtFixturePath(fs.readdirSync);
if (options.fault === 'remove-error') fs.rmSync = failAtFixturePath(fs.rmSync);
if (options.fault === 'changed-directory') {
  const lstat = fs.lstatSync;
  let observed = false;
  fs.lstatSync = (location, ...args) => {
    const stat = lstat(location, ...args);
    if (location === options.faultPath) {
      // Model a replacement between queueing the directory and descending into it.
      if (observed) stat.ino += 1n;
      observed = true;
    }
    return stat;
  };
}
