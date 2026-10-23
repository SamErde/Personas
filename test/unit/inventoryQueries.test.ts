import { describe, expect, it } from 'vitest';
import { isAgentsWindowProfile, profileLabel, withoutAgentsWindowProfile } from '../../src/core/inventoryQueries';
import type { Inventory, Profile } from '../../src/core/types';

const profile = (id: string, name: string, extra: Partial<Profile> = {}): Profile => ({
  id,
  name,
  isDefault: id === 'default',
  inheritsDefaultExtensions: false,
  ...extra,
});

const agents = profile('builtin/agents', 'Agents', { inheritsDefaultExtensions: true });

describe('isAgentsWindowProfile', () => {
  it('recognises VS Code built-in Agents window profile by its registry location', () => {
    expect(isAgentsWindowProfile(agents)).toBe(true);
  });

  it('does not treat a user profile that happens to be named Agents as the Agents window profile', () => {
    expect(isAgentsWindowProfile(profile('4328b3eb', 'Agents', { inheritsDefaultExtensions: true }))).toBe(false);
  });
});

describe('profileLabel', () => {
  it('labels the Agents window profile and explains that it mirrors Default', () => {
    expect(profileLabel(agents)).toEqual({
      label: '⤷ Agents window',
      tooltip:
        "VS Code's built-in profile for its separate Agents window. It uses the Default profile's extensions, " +
        'so this column always matches Default. Extensions removed from Default are removed here too.',
    });
  });

  it("marks a profile that uses Default's extensions with a leading arrow and a tooltip", () => {
    expect(profileLabel(profile('w1', 'Shared', { inheritsDefaultExtensions: true }))).toEqual({
      label: '⤷ Shared',
      tooltip: "Uses the Default profile's extensions.",
    });
  });

  it('leaves an ordinary profile unmarked', () => {
    expect(profileLabel(profile('w2', 'Work'))).toEqual({ label: 'Work' });
  });
});

describe('withoutAgentsWindowProfile', () => {
  it('drops only the Agents window profile', () => {
    const inv: Inventory = {
      profiles: [profile('default', 'Default'), profile('w1', 'Work'), agents],
      extensions: [],
      warnings: [],
    };
    expect(withoutAgentsWindowProfile(inv).profiles.map((p) => p.id)).toEqual(['default', 'w1']);
  });
});
