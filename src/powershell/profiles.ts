import * as path from 'node:path';

export type Edition = 'PowerShell 7' | 'Windows PowerShell';
export interface Installation { id: string; executable: string; home?: string; readOnly?: boolean }
export interface EditionInfo {
  edition: Edition;
  userDirectory?: string;
  installations: Installation[];
  reason?: string;
}
export interface ProfileLocation {
  id: string;
  edition: Edition;
  scope: 'Current User' | 'All Users';
  host: 'All Hosts' | 'Console' | 'VS Code' | 'ISE';
  path?: string;
  installation?: string;
  readOnly: boolean;
  reason?: string;
}
export type FileState = 'existing' | 'missing' | 'unresolved' | 'inaccessible' | 'brokenLink';
export interface ProfileRow extends ProfileLocation {
  state: FileState;
  target?: string;
  detail?: string;
}
export interface PowerShellInventory { editions: EditionInfo[]; rows: ProfileRow[]; error?: string }
export type ProfileAction = 'open' | 'delete' | 'copy' | 'reveal';

export function buildProfileLocations(platform: string, editions: EditionInfo[]): ProfileLocation[] {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const rows: ProfileLocation[] = [];
  for (const info of editions) {
    if (info.edition === 'Windows PowerShell' && platform !== 'win32') continue;
    const hosts: ProfileLocation['host'][] = ['All Hosts', 'Console', 'VS Code'];
    if (info.edition === 'Windows PowerShell') hosts.push('ISE');
    const groups = [
      { scope: 'Current User' as const, directory: info.userDirectory, installation: undefined, readOnly: false },
      ...info.installations.map(i => ({
        scope: 'All Users' as const, directory: i.home, installation: i.id, readOnly: !!i.readOnly,
      })),
    ];
    for (const group of groups) for (const host of hosts) {
      const filename = host === 'All Hosts' ? 'profile.ps1'
        : host === 'Console' ? 'Microsoft.PowerShell_profile.ps1'
        : host === 'VS Code' ? 'Microsoft.VSCode_profile.ps1' : 'Microsoft.PowerShellISE_profile.ps1';
      rows.push({
        id: JSON.stringify([info.edition, group.scope, group.installation ?? '', host]),
        edition: info.edition, scope: group.scope, host, installation: group.installation,
        path: group.directory ? paths.join(group.directory, filename) : undefined,
        readOnly: group.readOnly, reason: info.reason,
      });
    }
  }
  return rows;
}
