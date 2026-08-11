# Current workspace extension status plan

**Status:** Implemented; automated validation complete, disposable UI acceptance pending

**Date:** 2026-08-10

**Planning branch:** `plan/workspace-extension-status`
**Implementation branch:** `feat/current-workspace-extension-status`
**Implementation prompt:** `docs/plans/2026-08-10-current-workspace-extension-status-prompt.md`

## Goal

Present the currently loaded VS Code workspace alongside the existing profile list and profile columns, and show a trustworthy, read-only status for every extension:

- enabled for the current workspace;
- installed in the active profile but not enabled for the current workspace;
- not installed in the active profile;
- installed as a local workspace extension; or
- unknown when VS Code's stable API cannot support a stronger claim.

The workspace status must not change existing profile install/uninstall behavior, orphan detection, or the definition of `ExtensionRecord.installedIn`.

## VS Code semantics and product decisions

### Ordinary extensions

Marketplace and VSIX extensions are installed into a VS Code profile. An installed extension can then be enabled or disabled globally or for the current workspace. Workspace recommendations in `.vscode/extensions.json` and a `.code-workspace` file do not install or enable an extension.

### Local workspace extensions

VS Code 1.89 and later supports a distinct local workspace extension mechanism. An unpacked extension under a workspace's `.vscode/extensions` directory can be installed only for that workspace. This is not the same as a Marketplace extension recommendation or a normal profile installation.

### Approved scope

The first implementation will:

- include local workspace extensions and add rows for workspace-local extensions that do not exist in any profile;
- exclude extension recommendations and recommendation-ignore state;
- keep workspace cells and sidebar status read-only;
- use stable VS Code APIs plus Personas's existing read-only profile files;
- not read `state.vscdb`, add SQLite, or depend on proposed/private VS Code APIs;
- render `Unknown` when the supported sources cannot distinguish states safely;
- preserve the existing desktop-local, no-remote boundary.

## User experience

### Activity pane

Add a **Current workspace** card after the profile cards when a folder or workspace is open.

The card shows:

- the workspace name;
- the associated active profile when it can be resolved;
- counts for `Enabled`, `Not enabled`, and `Unknown` among extensions installed in the active profile or installed locally in the workspace;
- a `Workspace-local` count when one or more local workspace extensions are positively identified;
- a short read-only label so it is not confused with the editable profile manifest cards.

Selecting the card opens or focuses the Extension Matrix. When the current workspace is backed by
a saved, local `.code-workspace` JSON manifest, also provide `Open` (read-only preview) and `Edit`
actions for that manifest. These actions expose the shareable workspace configuration only; they
must not imply that VS Code's internal extension-enablement state is stored in the manifest. Folder,
untitled, and non-file workspaces have no local workspace manifest action.

When no workspace or folder is open, omit the card. The existing profile list continues to work unchanged.

### Extension Matrix

Add one visually separated final column after the profile columns:

`Current workspace`
`<workspace name>`

Each workspace cell has one non-interactive status and an accessible text/tooltip explanation:

| Status | Meaning | Suggested visual |
| --- | --- | --- |
| `Enabled` | VS Code's stable extension API reports the extension as available in this window. | `✓` plus `Enabled` accessible label |
| `Not enabled` | The extension is known to be installed in the active profile, is observable from Personas's extension host, and VS Code does not report it as available. This can include a global/workspace disable, trust, dependency, or compatibility constraint. | `○` plus `Not enabled` label |
| `Not installed in profile` | The active profile is known and does not contain the extension, and no positively installed workspace-local copy is visible. This does not claim that an unobservable local candidate is uninstalled. | `—` plus label |
| `Workspace-local` | The effective extension returned by VS Code is rooted inside a discovered `.vscode/extensions/<folder>` candidate. It is installed only for the current workspace. | `W` badge with enabled check |
| `Unknown` | Active-profile identity, profile manifest data, extension-host visibility, or workspace-local installation cannot be resolved through the approved sources. | `?` plus an actionable tooltip |

Use text, icons, and tooltips; do not rely on color alone. Add a compact legend above or below the table.

For an extension installed both in the active profile and as a workspace-local extension, show `Enabled`, identify both installation sources in the tooltip, and state which copy VS Code reports as the effective runtime location.

### Workspace-only rows

A valid extension manifest discovered under `.vscode/extensions/<folder>` can introduce a row absent from the profile inventory.

- Profile cells on such a row are read-only dashes. They must not call the Marketplace CLI because a workspace-local extension might not be published or might differ from a published extension with the same ID.
- The hover card labels the source as `Workspace-local` or `Workspace-local candidate`.
- Hide profile bulk actions until the extension also has a normal profile-backed `ExtensionRecord`.
- Use the existing letter tile for the first increment; do not widen webview `localResourceRoots` to arbitrary workspace roots merely to load icons.

## State model

Keep workspace state orthogonal to the profile inventory. Do not add a synthetic workspace ID to `Inventory.profiles`, and do not add workspace membership to `ExtensionRecord.installedIn`.

Add types along these lines in `src/core/types.ts` (names may be refined during implementation without changing the semantics):

```ts
export type WorkspaceExtensionState =
  | 'enabled'
  | 'notEnabled'
  | 'notInstalledInProfile'
  | 'unknown';

export interface WorkspaceDescriptor {
  name: string;
  kind: 'folder' | 'workspace';
  associationUri: string;
  manifestFsPath?: string;
  rootFsPaths: string[];
}

export interface WorkspaceLocalExtension {
  id: string;
  displayName: string;
  version?: string;
  fsPath: string;
  runtimeVisible: boolean;
}

export interface WorkspaceExtensionStatus {
  id: string;
  state: WorkspaceExtensionState;
  installedInActiveProfile: boolean | 'unknown';
  workspaceLocal: 'installed' | 'candidate' | 'none';
  runtimeSource: 'profile' | 'workspace' | 'unknown';
  reason: string;
}

export interface WorkspaceInventory {
  descriptor: WorkspaceDescriptor;
  activeProfileId?: string;
  activeProfileName?: string;
  extensions: WorkspaceExtensionStatus[];
  localExtensions: WorkspaceLocalExtension[];
  warnings: string[];
}
```

Send `workspace?: WorkspaceInventory` beside the existing `inventory` in the `HostToWebview` inventory message. Keeping it separate prevents profile mutation and orphan-cleanup helpers from accidentally treating a workspace as a profile.

## Data sources and truth rules

### Workspace descriptor

Build a host-side descriptor from stable VS Code APIs:

- `.code-workspace` or saved multi-root workspace: `vscode.workspace.workspaceFile` is the association URI;
- a saved local `.code-workspace` file also supplies a manifest path for explicit read-only and edit actions;
- single-folder workspace: the only `vscode.workspace.workspaceFolders` URI is the association URI;
- workspace name: `vscode.workspace.name`, falling back to the folder/workspace basename;
- roots: all local `workspaceFolders` file-system paths;
- no folder/workspace: no descriptor and no workspace UI.

Untitled or non-file workspaces may be displayed, but profile association and workspace-local discovery should become `Unknown` when a local, stable identity is unavailable.

### Active profile

The stable extension API does not expose the current user-data profile. Personas already reads VS Code's `globalStorage/storage.json`, which currently includes `profileAssociations.workspaces`.

Add a defensive parser for that optional map. Resolve the descriptor's exact URI key to:

- `__default__profile__` -> Personas profile ID `default`;
- a known registry `location` -> that profile ID;
- a missing, malformed, or unknown value -> unresolved.

Do not silently assume the default profile unless the implementation spike verifies that a missing association has that meaning across supported VS Code versions and workspace kinds. An unresolved association produces `installedInActiveProfile: 'unknown'` and a visible warning, not a guessed profile.

The parser must tolerate unrelated `storage.json` keys, malformed association entries, URI escaping, Windows case differences, and missing maps without weakening the existing profile-registry error handling.

### Effective enablement

Use the normalized IDs and locations from `vscode.extensions.all`; subscribe to `vscode.extensions.onDidChange` and refresh both workspace surfaces when it fires.

Do not use `Extension.isActive`: activation is lazy and is not enablement.

Treat presence in `vscode.extensions.all` as positively enabled/available in the current window. Treat absence as `Not enabled` only when all of the following are true:

1. the extension is known to be installed in the active profile;
2. the implementation spike confirms that its extension kind is observable from Personas's local UI extension host; and
3. the relevant profile manifest was read successfully.

Otherwise use `Unknown`. The tooltip must explain the unavailable evidence rather than claim an explicit workspace disable.

### Local workspace extension discovery

For each local workspace root, inspect only immediate child directories under `.vscode/extensions` and defensively read `package.json`.

- Normalize IDs to lowercase `publisher.name`.
- Reuse the package metadata safety rules where applicable.
- Reject missing/invalid publisher or name fields, path escapes, and non-directory entries with a non-fatal warning.
- Merge duplicate IDs deterministically and warn when multiple roots contain the same ID.
- Classify a candidate as positively installed when an entry in `vscode.extensions.all` has the same ID and an extension URI contained by that candidate directory.
- A candidate that is not visible through the stable API is `candidate` plus `Unknown`, never `installed` or `disabled`.

Do not parse `workspaceExtensions.locations` from workspace SQLite storage. Do not interpret `.vscode/extensions.json` recommendations as candidates or installations.

## Architecture

Add a pure/injected workspace-status layer rather than putting VS Code calls in the webview or profile inventory composer.

Suggested split:

- `src/core/parsers.ts`
  - parse optional workspace-to-profile associations;
- `src/core/workspace.ts`
  - pure descriptor/profile resolution, candidate normalization, status composition, count helpers;
- `src/servicesFactory.ts`
  - adapt `vscode.workspace`, `vscode.extensions.all`, and `vscode.workspace.fs` into a `WorkspaceInventoryService` with injected I/O;
- `src/panel/matrixPanel.ts`
  - refresh profile and workspace inventories, build safe icon mappings only for existing profile-pool icons, and post both models;
- `src/panel/welcomeView.ts`
  - build and post a separate workspace view model;
- `src/webview/render.ts`
  - form the union of profile-backed and workspace-only rows and derive read-only workspace cells;
- `src/webview/main.ts`, `src/webview/welcome.ts`, `src/webview/style.css`
  - render the column, legend, tooltips, workspace card, and accessible labels.

`WorkspaceInventoryService` should accept injected functions for directory listing, file reading, and the effective extension snapshot so unit tests remain zero-network and independent of a VS Code host.

## Refresh behavior

Extend the existing debounced refresh path rather than creating a second scheduler.

Refresh workspace state when:

- `vscode.extensions.onDidChange` fires;
- a file under a workspace root's `.vscode/extensions` directory changes;
- `vscode.workspace.onDidChangeWorkspaceFolders` fires;
- Workspace Trust is granted;
- the existing profile `storage.json` watcher fires; or
- the user requests Refresh.

Rebuild workspace-folder watchers when the root set changes and dispose every watcher through the extension context. Do not recursively watch the whole workspace.

## Implementation tasks

### 1. Verify the supported API boundary

Create a small sandboxed development spike and record the results in `docs/spikes/workspace-extension-status.md`.

Verify on the minimum supported VS Code line and the current stable line:

- enabled profile extension appears in `vscode.extensions.all`;
- Disable (Workspace) removes it and triggers `vscode.extensions.onDidChange`;
- re-enable restores it;
- an installed local workspace extension is reported with a URI inside `.vscode/extensions`;
- an uninstalled local candidate is not reported as installed;
- the active folder and saved multi-root workspace association keys match `profileAssociations.workspaces`;
- explicit profile launch and default profile mapping are distinguishable;
- browser-only/static extension visibility from Personas's `extensionKind: ["ui"]` host is documented.

If a result contradicts the truth rules above, retain `Unknown` for that case. Do not introduce private commands, proposed APIs, or SQLite as a workaround.

### 2. Parse and resolve workspace/profile identity

- Add focused parser types and tests for `profileAssociations.workspaces`.
- Add pure descriptor-key matching and active-profile resolution.
- Preserve the existing `parseProfileRegistry` API or update its callers atomically.
- Fail closed on malformed or unknown associations.

### 3. Discover local workspace extension candidates

- Add injected, bounded scanning for `.vscode/extensions/<candidate>/package.json`.
- Normalize manifest metadata and detect duplicates.
- Compose candidate/runtime matches without treating mere file presence as installation.
- Add candidate-only records to the workspace inventory, not the profile inventory.

### 4. Compose workspace status

- Join active-profile membership, parse warnings, local candidates, and the stable runtime snapshot.
- Implement the status precedence and reason strings as a table-driven pure function.
- Add count helpers for the activity-pane card.
- Ensure app-scoped and inherited profile installs resolve through the existing `installedIn` membership for the active profile.

### 5. Wire services and refresh events

- Construct the workspace inventory service once with the existing services.
- Refresh profile and workspace data together without making profile mutations depend on workspace status.
- Register and dispose the new extension/workspace/candidate watchers.
- Keep unsupported remote and development-host guards unchanged.

### 6. Render the activity-pane card

- Extend the welcome protocol with a separate optional workspace model.
- Render workspace name, active profile, counts, warning/unknown state, and read-only wording.
- Make the card open the matrix; do not add extension enablement controls.
- For a saved local `.code-workspace` manifest, add explicit read-only `Open` and direct `Edit`
  actions for that JSON file; do not add extension enable/disable/install controls.
- Preserve all existing profile cards and orphan actions.

### 7. Render the matrix column and workspace-only rows

- Extend `buildViewModel` to union profile-backed records with workspace-only records.
- Add the separated current-workspace header and read-only cells.
- Add an accessible legend and exact tooltips.
- Hide or disable profile actions for workspace-only rows.
- Preserve filtering, chips, pending spinners, hover-card focus behavior, and cleanup mode.

### 8. Document the feature

Update `README.md` to explain:

- ordinary installs are profile-scoped;
- workspace enablement is read-only in Personas;
- local workspace extensions are a separate mechanism;
- recommendations are not installation state;
- `Unknown` protects against unsupported inference.

Do not edit version files or publish artifacts.

## Test plan

### Unit tests

Add or extend tests for:

- missing, valid, malformed, and unknown profile associations;
- default-profile sentinel and named-profile resolution;
- Windows URI case/escaping and POSIX paths;
- folder, saved multi-root, untitled, and empty-window descriptors;
- safe candidate discovery, invalid manifests, duplicates, and path containment;
- every workspace status transition in a table-driven test;
- inherited and application-scoped active-profile membership;
- unreadable active profile -> `Unknown`;
- runtime-visible workspace-local candidate -> installed/enabled;
- non-visible candidate -> candidate/unknown;
- browser-only or otherwise unobservable profile extension -> unknown rather than disabled;
- workspace-only row union, filtering, read-only profile cells, hidden bulk actions, and counts;
- no workspace -> no workspace card or column;
- all new protocol shapes and existing smoke/CSP checks.

### Integration tests

Extend the sandboxed `@vscode/test-electron` harness to open an actual local workspace and validate:

- the default-profile fixture is positively enabled in the workspace snapshot when observable;
- a `.vscode/extensions` candidate is discovered without being mislabeled installed;
- `vscode.extensions.onDidChange` schedules refresh when the test host can safely exercise it;
- no real user-data, extension, or workspace state is read or changed.

Keep any enable/disable UI verification that cannot be automated in a dedicated disposable VS Code sandbox.

### Manual acceptance

In a disposable VS Code sandbox, verify:

1. empty window: profiles remain, workspace card/column absent;
2. single folder: workspace card and final matrix column use the folder name;
3. saved multi-root workspace: one aggregate workspace card/column appears;
4. enabled profile extension: `Enabled`;
5. Disable (Workspace): `Not enabled` after the VS Code refresh/restart flow;
6. globally disabled but Enable (Workspace): `Enabled`;
7. extension absent from active profile: `Not installed in profile`;
8. local candidate not installed: `Unknown`, identified as a candidate;
9. installed local workspace extension: workspace-only row and `Workspace-local` enabled state;
10. duplicate candidate IDs across roots: deterministic row plus warning;
11. malformed active-profile/candidate data: warning and `Unknown`, with no actions enabled;
12. existing profile toggles, bulk actions, filters, hover card, and orphan cleanup remain unchanged.

The computer-control backend was unavailable during implementation (`spawn EPERM` on three
helper attempts, followed by no callable desktop-control tool), so these visible UI checks remain
pending in the disposable sandbox. The supported-API spike and integration harness cover the
underlying folder descriptor, candidate discovery, runtime status, and change-event paths without
substituting private APIs or inferred results for the checklist above.

Run:

```text
npm run lint
npm test
npm run build
npm run test:integration
git diff --check
```

## Acceptance criteria

- A current workspace appears in both the activity pane and Extension Matrix when one is loaded.
- The workspace is visually similar to, but not modeled as, a profile.
- Every shown workspace state is derived from documented evidence; ambiguous cases say `Unknown`.
- Workspace-local extensions can add rows without becoming false profile installs or false orphans.
- Workspace-only rows cannot trigger profile CLI installation or bulk actions.
- No workspace action mutates extension enablement, profile manifests, workspace files, or VS Code SQLite state.
- No recommendations are presented as installed or enabled.
- Existing profile install/uninstall and orphan cleanup behavior is unchanged.
- All unit, build, lint, integration, and manual acceptance checks pass.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| `vscode.extensions.all` is extension-host scoped | Verify representative kinds; use `Unknown` outside proven visibility. |
| `profileAssociations` is private and can drift | Defensive parser, exact fixture tests, visible warning, no default guess without evidence. |
| Local candidate presence is confused with installation | Require a matching stable runtime extension URI for positive installation. |
| Workspace-only row invokes Marketplace/profile mutations | Explicit non-mutable row capability; host revalidates against profile inventory. |
| Local extension paths or manifests are malicious | Bounded immediate-child scan, containment checks, defensive JSON parsing, no widened icon roots. |
| New watchers are noisy or leak | Watch only `.vscode/extensions`, share debounce, rebuild/dispose on root changes. |
| Workspace state contaminates orphan logic | Separate `WorkspaceInventory`; never write workspace IDs into `installedIn`. |

## Research references

- [VS Code Extension Marketplace: profile installation, workspace enable/disable, recommendations, and install locations](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace)
- [VS Code 1.89: local workspace extensions](https://code.visualstudio.com/updates/v1_89)
- [VS Code API: `vscode.extensions.all` and `onDidChange`](https://code.visualstudio.com/api/references/vscode-api#extensions)
- [VS Code source: public extensions API is backed by the current extension host registry](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHost.api.impl.ts)
- [VS Code source: workspace enablement and other effective disablement states](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts)
- [VS Code source: local workspace extension installation is stored separately from profile installs](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensionManagement/common/extensionManagementService.ts)
