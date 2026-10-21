import type { CleanupService } from './cleanup';
import { directInstallProfileIds, installEverywhereTargets, removeEverywhereTargets } from './inventory';
import type { MutationService } from './mutations';
import type { Inventory, Profile } from './types';

type CleanupResults = Awaited<ReturnType<CleanupService['deleteFolders']>>;

/** The prompts and webview pushes the Extension Matrix rules need, kept free of the vscode API. */
export interface MatrixActionsUi {
  /** Shows a modal warning; resolves true only when the user picks `action`. */
  confirm(message: string, action: string): Promise<boolean>;
  /** Non-modal notice; never waits for the user, so it cannot hold up queued work. */
  inform(message: string): void;
  markPending(extId: string, profileId: string): void;
  showCleanupResult(results: CleanupResults): void;
}

export interface MatrixActionsDeps {
  mutations: Pick<MutationService, 'install' | 'uninstall'>;
  cleanup: Pick<CleanupService, 'deleteFolders'>;
  ui: MatrixActionsUi;
  /** Re-reads disk and pushes a fresh inventory; that push is what clears the webview's pending state. */
  refresh(): Promise<void>;
}

/**
 * The Extension Matrix's change rules: which clicks may change a profile, when to ask first, and
 * how a bulk run stops. Each method acts on the inventory the webview last rendered. Errors from
 * the CLI propagate to the caller, which reports them and re-syncs.
 */
export class MatrixActions {
  constructor(private readonly deps: MatrixActionsDeps) {}

  async toggleCell(inv: Inventory | undefined, extId: string, profileId: string, install: boolean): Promise<void> {
    // The webview marks the clicked cell pending the moment the user acts, and only a fresh
    // inventory push clears it — so every bail below re-syncs rather than silently returning.
    const profile = inv?.profiles.find((p) => p.id === profileId);
    const ext = inv?.extensions.find((x) => x.id === extId);
    if (!inv || !profile || !ext || profile.inheritsDefaultExtensions || disabledProfileIds(inv).has(profileId)) {
      return this.deps.refresh();
    }
    // Stale click: a watcher-driven refresh already removed it from this profile.
    if (!install && !ext.installedIn.includes(profileId)) return this.deps.refresh();

    // installedIn includes profiles that merely inherit Default's extensions, so it overcounts
    // who would lose the extension — count direct installs only to find the last-profile case.
    const direct = directInstallProfileIds(inv, extId);
    if (!install && direct.length === 1 && direct[0] === profileId) {
      const confirmed = await this.deps.ui.confirm(
        `"${ext.displayName}" is installed only in the "${profile.name}" profile. Uninstall it from your last profile?${cascadeWarning(inv, profile.isDefault)}`,
        'Uninstall',
      );
      if (!confirmed) return this.deps.refresh();
    }

    this.deps.ui.markPending(extId, profileId);
    await this.mutate(install, extId, profile);
    await this.deps.refresh();
  }

  /** "Install in every profile" / "Remove from every profile": one confirmation, then one CLI call per profile. */
  async everyProfile(inv: Inventory | undefined, extId: string, op: 'install' | 'remove'): Promise<void> {
    const ext = inv?.extensions.find((x) => x.id === extId);
    // Stale/unknown id: the bulk button is already locally pending, so re-sync to clear it.
    if (!inv || !ext) return this.deps.refresh();

    const flow = EVERY_PROFILE[op];
    const targets = flow.targets(inv, extId);
    if (targets.length === 0) {
      this.deps.ui.inform(flow.nothingToDo);
      return this.deps.refresh();
    }
    // Removal warns like the last-profile path in toggleCell whenever Default is a target.
    const cascade = op === 'remove' ? cascadeWarning(inv, targets.some((p) => p.isDefault)) : '';
    const confirmed = await this.deps.ui.confirm(
      `${flow.verb} "${ext.displayName}" ${flow.preposition} ${targets.length} profile(s)?\n\n${targets.map((p) => p.name).join('\n')}${cascade}`,
      flow.verb,
    );
    if (!confirmed) return this.deps.refresh();

    for (const p of targets) this.deps.ui.markPending(extId, p.id);
    // Sequential and awaited so a mid-run failure stops the remaining calls instead of racing
    // ahead. MutationService already serializes the CLI calls; this loop owns stop-on-error.
    for (const p of targets) {
      await this.mutate(op === 'install', extId, p);
    }
    await this.deps.refresh();
  }

  async cleanup(inv: Inventory | undefined, folderNames: string[]): Promise<void> {
    if (!inv || folderNames.length === 0) return this.deps.refresh();
    // Defense in depth: only ever target folders of orphaned extensions, even though the webview
    // only offers orphan folders — deleteFolders itself performs no orphan verification.
    const requested = new Set(folderNames);
    const targets = inv.extensions
      .filter((e) => e.orphaned)
      .flatMap((e) => e.versions)
      .filter((v) => requested.has(v.folderName));
    if (targets.length === 0) {
      this.deps.ui.inform('None of the selected folders belong to an orphaned extension any more.');
      return this.deps.refresh();
    }
    const confirmed = await this.deps.ui.confirm(
      `Move ${targets.length} extension folder(s) to the Recycle Bin/Trash?\n\n${targets.map((t) => t.folderName).join('\n')}`,
      'Move to Trash',
    );
    if (!confirmed) return this.deps.refresh();
    this.deps.ui.showCleanupResult(await this.deps.cleanup.deleteFolders(targets));
    await this.deps.refresh();
  }

  /** The `code` CLI targets the Default profile by omitting `--profile`. */
  private mutate(install: boolean, extId: string, profile: Profile): Promise<void> {
    const profileName = profile.isDefault ? undefined : profile.name;
    return install
      ? this.deps.mutations.install(extId, profileName)
      : this.deps.mutations.uninstall(extId, profileName);
  }
}

const EVERY_PROFILE = {
  install: {
    targets: installEverywhereTargets,
    verb: 'Install',
    preposition: 'into',
    nothingToDo: 'Already installed in every profile.',
  },
  remove: {
    targets: removeEverywhereTargets,
    verb: 'Remove',
    preposition: 'from',
    nothingToDo: 'Not directly installed in any profile.',
  },
} as const;

/**
 * Sentence appended to uninstall confirmations when the Default profile is affected and other
 * profiles inherit its extensions — they lose the extension too. Empty when not applicable.
 */
function cascadeWarning(inv: Inventory, defaultIsAffected: boolean): string {
  const inheriting = defaultIsAffected ? inv.profiles.filter((p) => p.inheritsDefaultExtensions) : [];
  return inheriting.length > 0
    ? ` Profiles that inherit the Default profile's extensions (${inheriting.map((p) => p.name).join(', ')}) will also lose it.`
    : '';
}

/** Profiles a warning disabled: unreadable data, or a name the code CLI cannot tell apart. */
function disabledProfileIds(inv: Inventory): Set<string> {
  return new Set(inv.warnings.flatMap((w) => w.affectedProfileIds));
}
