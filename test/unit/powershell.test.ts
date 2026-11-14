import { describe, it, expect } from 'vitest';
import { buildProfileLocations } from '../../src/powershell/profiles';

describe('PowerShell profile inventory', () => {
  it('shares current-user rows and separates installation-specific all-users rows', () => {
    const rows = buildProfileLocations('linux', [{
      edition: 'PowerShell 7', userDirectory: '/home/me/.config/powershell',
      installations: [
        { id: 'one', executable: '/one/pwsh', home: '/one' },
        { id: 'two', executable: '/two/pwsh', home: '/two' },
      ],
    }]);
    expect(rows.filter(r => r.scope === 'Current User')).toHaveLength(3);
    expect(rows.filter(r => r.scope === 'All Users')).toHaveLength(6);
    expect(rows.map(r => r.path)).toContain('/two/Microsoft.VSCode_profile.ps1');
    expect(rows.some(r => r.host === 'ISE')).toBe(false);
  });
});
