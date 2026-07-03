// Prints the live profile/extension state of this machine's VS Code Stable install.
// Read-only. Run: node scripts/spike-formats.mjs [userDataDir] [extensionsDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const platformDefaults = {
  win32: path.join(process.env.APPDATA ?? '', 'Code'),
  darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Code'),
  linux: path.join(os.homedir(), '.config', 'Code'),
};
const userData = process.argv[2] ?? platformDefaults[process.platform];
const extDir = process.argv[3] ?? path.join(os.homedir(), '.vscode', 'extensions');

const storage = JSON.parse(fs.readFileSync(path.join(userData, 'User', 'globalStorage', 'storage.json'), 'utf8'));
console.log('--- userDataProfiles ---');
console.log(JSON.stringify(storage.userDataProfiles ?? [], null, 2));

const globalManifest = JSON.parse(fs.readFileSync(path.join(extDir, 'extensions.json'), 'utf8'));
const folders = fs.readdirSync(extDir, { withFileTypes: true }).filter((d) => d.isDirectory());
console.log(`--- global manifest: ${globalManifest.length} entries; ${folders.length} folders on disk ---`);
console.log('appScoped:', globalManifest.filter((e) => e.metadata?.isApplicationScoped).map((e) => e.identifier.id));

for (const p of storage.userDataProfiles ?? []) {
  const file = path.join(userData, 'User', 'profiles', p.location, 'extensions.json');
  const inheritsExt = p.useDefaultFlags?.extensions === true;
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  console.log(`profile "${p.name}" (${p.location}) inheritsExtensions=${inheritsExt} own=${list ? list.length : 'none'}`);
}

const obsoletePath = path.join(extDir, '.obsolete');
console.log('.obsolete:', fs.existsSync(obsoletePath) ? fs.readFileSync(obsoletePath, 'utf8') : '(absent)');
