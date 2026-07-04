import Mocha from 'mocha';
import * as path from 'node:path';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 120000, color: true });
  mocha.addFile(path.resolve(__dirname, 'inventory.test.js'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures === 0 ? resolve() : reject(new Error(`${failures} test(s) failed`))));
  });
}
