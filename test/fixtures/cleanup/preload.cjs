// Runs only in the test-owned cleanup subprocess. Match against the kernel cwd
// because the POSIX directory handle changes it directly with fchdir.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const options = JSON.parse(process.env.CLEAN_TEST_OPTIONS);
const { response = ['1.110.0'], status = 200 } = options;
globalThis.fetch = async () => {
  if (!status) throw new Error('simulated timeout');
  return Response.json(response, { status });
};

function fail() {
  throw new Error(`simulated ${options.fault}`);
}

function differentIdentity(invoke) {
  const stat = invoke();
  stat.ino += 1n;
  return stat;
}

function rotate(invoke) {
  const root = path.dirname(options.cache);
  try {
    fs.renameSync(options.cache, path.join(root, 'original'));
    fs.renameSync(path.join(root, 'replacement'), options.cache);
    console.error('rotation completed');
  } catch (error) {
    assert.ok(['EBUSY', 'EPERM', 'EACCES'].includes(error.code), error);
    console.error('rotation blocked');
  }
  return invoke();
}

// Each scenario intercepts one call at one exact fixture path, then restores fs.
const hooks = new Map([
  ['marker-error', ['lstatSync', fail]],
  ['scan-error', ['readdirSync', fail]],
  ['remove-error', ['rmdirSync', fail]],
  ['changed-directory', ['lstatSync', differentIdentity]],
  ['rotate-at-list', ['readdirSync', rotate]],
  ['rotate-at-unlink', ['unlinkSync', rotate]],
]);
if (hooks.has(options.fault)) {
  const [method, action] = hooks.get(options.fault);
  const original = fs[method];
  fs[method] = (location, ...args) => {
    const invoke = () => original(location, ...args);
    const absolute = path.resolve(fs.realpathSync.native('.'), location);
    if (absolute !== options.faultPath) return invoke();
    fs[method] = original;
    return action(invoke);
  };
}
