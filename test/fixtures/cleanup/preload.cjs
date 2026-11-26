// Runs only in the temporary cleanup CLI subprocess spawned by clean.test.ts.
const fs = require('node:fs');
const options = JSON.parse(process.env.CLEAN_TEST_OPTIONS);

globalThis.fetch = async () => {
  if (options.fault === 'timeout') throw new Error('simulated timeout');
  if (options.fault === 'http-error') return { ok: false, status: 503 };
  return { ok: true, json: async () => options.response ?? ['1.110.0'] };
};

const method = {
  'marker-error': 'lstatSync',
  'scan-error': 'readdirSync',
  'remove-error': 'rmSync',
}[options.fault];
if (method) {
  const original = fs[method];
  fs[method] = (location, ...args) => {
    if (location === options.faultPath) throw new Error(`simulated ${options.fault}`);
    return original(location, ...args);
  };
}
