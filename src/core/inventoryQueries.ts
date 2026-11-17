// Read-only questions about a composed Inventory, shared by the host and the webviews. The
// webview bundles import this module, so it must not import anything that needs Node.
import type { Inventory, Profile, WorkspaceExtensionStatus } from './types';

/** Profiles a warning disabled: unreadable data, or a name the code CLI cannot tell apart. */
export function disabledProfileIds(inventory: Inventory): Set<string> {
  return new Set(inventory.warnings.flatMap((w) => w.affectedProfileIds));
}

/** Profiles whose installed extensions are unknown because a list could not be read. A profile
 * that uses Default's extensions is unknown whenever Default's list is. Duplicate-name warnings
 * are left out: those profiles' lists were read. */
export function unreadableProfileIds(inventory: Inventory): Set<string> {
  const ids = new Set(inventory.warnings.filter((w) => w.kind === undefined).flatMap((w) => w.affectedProfileIds));
  if (ids.has('default')) {
    for (const profile of inventory.profiles) if (profile.inheritsDefaultExtensions) ids.add(profile.id);
  }
  return ids;
}

/** Profiles the code CLI cannot target because their name is shared or shadows Default. */
export function duplicateNameProfileIds(inventory: Inventory): Set<string> {
  return new Set(
    inventory.warnings.filter((w) => w.kind === 'duplicateName').flatMap((w) => w.affectedProfileIds),
  );
}

export function orphanCount(inventory: Inventory): number {
  return inventory.extensions.filter((e) => e.orphaned).length;
}

/** Whether the workspace column offers the hand-off to VS Code's own "Enable (Workspace)" /
 * "Disable (Workspace)" actions (ADR-0003): for Enabled (which includes Workspace-local) and
 * Not enabled; never for Not installed in profile or Unknown. */
export function offersWorkspaceEnablementGuide(status: WorkspaceExtensionStatus): boolean {
  return status.state === 'enabled' || status.state === 'notEnabled';
}

/** Registry `location` of VS Code's built-in profile for its separate Agents window. The only
 * on-disk marker: the registry stores no id or internal flag (docs/spikes/findings.md). */
const AGENTS_WINDOW_PROFILE_LOCATION = 'builtin/agents';

/** VS Code's Agents window profile, by exact registry location; a user profile merely named
 * "Agents" is an ordinary profile. */
export function isAgentsWindowProfile(profile: Profile): boolean {
  return !profile.isDefault && profile.id === AGENTS_WINDOW_PROFILE_LOCATION;
}

/** A profile's plain name, as read aloud and in accessible names: the Agents window profile is
 * named for the window it serves. */
export function profileName(profile: Profile): string {
  return isAgentsWindowProfile(profile) ? 'Agents window' : profile.name;
}

/** How a profile is named in the matrix and Home: its plain name, with a leading ⤷ marking one
 * that uses Default's extensions. */
export function profileLabel(profile: Profile): { label: string; tooltip?: string } {
  if (isAgentsWindowProfile(profile)) {
    return {
      label: `⤷ ${profileName(profile)}`,
      tooltip:
        "VS Code's built-in profile for its separate Agents window. It uses the Default profile's extensions, " +
        'so this column always matches Default. Extensions removed from Default are removed here too.',
    };
  }
  if (profile.inheritsDefaultExtensions) {
    return { label: `⤷ ${profile.name}`, tooltip: "Uses the Default profile's extensions." };
  }
  return { label: profile.name };
}

/** The inventory as shown when the `personas.showAgentsWindowProfile` setting is off. */
export function withoutAgentsWindowProfile(inventory: Inventory): Inventory {
  return { ...inventory, profiles: inventory.profiles.filter((p) => !isAgentsWindowProfile(p)) };
}
