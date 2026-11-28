# Spike — current workspace extension status

**Date:** 2026-08-10
**Machine:** Windows 11 x64
**VS Code lines:** 1.90.2 (minimum supported line at the time; since raised to 1.101) and 1.132.0 (current Stable)
**Harness:** `docs/spikes/probes/spike-workspace-status.mjs`

## Boundary and setup

The probe used only stable `vscode.workspace` and `vscode.extensions` APIs, the documented VS Code CLI, and read-only inspection of `globalStorage/storage.json`. Each run created separate temporary `--user-data-dir` and `--extensions-dir` directories. API/event checks ran in the extension test host; profile-association checks used a packaged probe installed into short-lived regular VS Code windows. It opened only the fixtures now under `test/fixtures/multi-root-workspace`; it did not read or change the user's VS Code data.

Run:

```text
node docs/spikes/probes/spike-workspace-status.mjs 1.90.2 stable
```

The fixture set included:

- an ordinary inert profile extension;
- an inert browser-only extension with `extensionKind: ["workspace"]`;
- a development extension with `extensionKind: ["ui"]` that captured API snapshots, then the same probe packaged and installed into both disposable profiles for regular-window association checks;
- an unpacked but uninstalled candidate under `.vscode/extensions`; and
- a folder plus a saved two-root `.code-workspace` fixture.

## Results

| Check | 1.90.2 | 1.132.0 Stable | Product decision |
| --- | --- | --- | --- |
| Installed ordinary extension is in `vscode.extensions.all` | Confirmed | Confirmed | Presence is positive evidence that the extension is available in the current window. |
| Removing/reinstalling the fixture changes `extensions.all` | Confirmed | Confirmed | Refresh from a new API snapshot; do not cache enablement. |
| `vscode.extensions.onDidChange` fires for the changes | Two events for uninstall/reinstall | Two events for uninstall/reinstall | Subscribe once and use the existing debounced refresh path. |
| Browser-only `extensionKind: ["workspace"]` fixture is visible from the UI development host | Confirmed | Confirmed | The local desktop snapshot is not limited to extensions declaring `ui`. |
| Static fixture with no `main` or `browser` entry is visible | Confirmed | Confirmed | Static extensions are observable in the same snapshot. |
| Merely placing a valid unpacked extension under `.vscode/extensions` installs it | No; absent from the API snapshot | No; absent from the API snapshot | A candidate without a matching runtime URI is `Unknown`, never installed or disabled. |
| Single-folder descriptor URI | `file:///c%3A/.../workspace-root` | Same normalized form | Use the folder URI as the association key. |
| Saved multi-root descriptor URI | `.code-workspace` file URI | Same normalized form | Use `workspaceFile`, not one of its roots, as the association key. |
| Regular-window folder and saved-workspace profile associations | Confirmed | Confirmed | The exact folder or `.code-workspace` URI maps to the selected profile ID; Default is stored as `__default__profile__`. |

The uninstall/reinstall portion used the public CLI rather than workspace enablement controls. It therefore verifies the stable API's positive/negative visibility and change-event behavior, but it does not identify why an installed extension is absent. The UI must say `Not enabled`, not `Disabled (Workspace)` or any other exact disable reason.

## Profile association finding

Extension-development and extension-test windows intentionally do not persist workspace/profile associations. The initial test-host phase left `profileAssociations.workspaces` empty, matching the VS Code source branch that skips `setProfileForWorkspace` when `extensionDevelopmentPath` is present.

The revised association phase packaged and installed the probe extension, launched regular windows with the same disposable directories, waited for the stable workspace API descriptor, and then read `storage.json` after that window exited. On both 1.90.2 and 1.132.0:

- a saved multi-root workspace opened under Default mapped its exact `.code-workspace` URI to `__default__profile__`;
- a folder opened under `SpikeNamed` mapped its exact folder URI to that profile's generated location ID; and
- the same saved workspace opened under `SpikeNamed` replaced the Default mapping with that same generated profile ID.

This confirms the source-level distinction with production-window evidence rather than treating the development-host absence as the result. The generated named-profile IDs differed between disposable runs, as expected, so the implementation resolves them through the profile registry rather than assuming a fixed value.

Implementation consequence: parse the optional map defensively and resolve only an exact, URI-normalized association. Missing, malformed, or unknown associations remain `Unknown`; do not infer the Default profile. This also protects development hosts and any startup/write race.

## Workspace-local installation finding

The candidate-only result was directly verified. A positively installed local workspace extension could not be exercised through the UI because the Windows app-control helper failed three times with `spawn EPERM` (including its required reset/retry), and the documented CLI correctly rejected an unpacked directory as an install target.

No private command or SQLite fallback was used. The stable API boundary remains:

- discover bounded candidates from `.vscode/extensions/<folder>/package.json`;
- classify a candidate as `Workspace-local` only when `vscode.extensions.all` contains the same normalized ID and its public `extensionUri` is contained by that exact candidate directory; and
- otherwise keep the candidate as `Unknown`.

This positive rule is also consistent with VS Code's workspace-extension implementation: it scans the selected source location, retains that location on the registered workspace-scoped extension, and stores the installed-location list in workspace-scoped internal storage. Personas does not read that storage.

## Claims deliberately not made

- `Extension.isActive` was not used; activation remains lazy and is not an enablement signal.
- Absence from `extensions.all` is not presented as an exact workspace-disable reason.
- A local manifest candidate is not called installed without a matching public runtime URI.
- A missing profile association is not treated as the Default profile.
- No recommendation file, proposed/private API, internal command, SQLite database, or VS Code state write is part of the implementation.

## Implementation integration follow-up

The finished integration harness opens a copied workspace fixture with disposable
`--user-data-dir` and `--extensions-dir` locations. In VS Code Stable 1.132.0 it confirmed that:

- a valid unpacked `.vscode/extensions` fixture is discovered but remains a candidate with
  `Unknown` status when it has no matching public runtime entry;
- installing an ordinary VSIX fires `vscode.extensions.onDidChange` and the resulting workspace
  snapshot reports the fixture `Enabled` with its public `extensionUri`; and
- uninstalling the fixture fires the event again and removes it from the public snapshot.

The fixture workspace and both VS Code state directories were temporary copies; the user's real
workspace, profile registry, and extension directory were not used.

## Manual follow-up

**Status: passed.** The manual UI checks listed below were run in a disposable sandbox on
2026-10-20 and passed, as scenarios 1–11 of the "Manual test scenarios" checklist in
`docs/local-build-test-and-release.md` ([results on #68](https://github.com/SamErde/Personas/issues/68#issuecomment-6305363767)).
Scenarios 12–14 are tracked in [#167](https://github.com/SamErde/Personas/issues/167). The scenario
numbers are those in the release guide.

- Disable (Workspace), re-enable, and observe the refresh/restart flow;
- install the local candidate from the Workspace Recommendations view and confirm the public runtime URI; and
- exercise the final Personas activity card and matrix states after implementation.

Enablement can't be changed through the CLI. `code --help` on VS Code 1.143.0 (checked
2026-10-22) says of `--disable-extension`: "Disable the provided extension. This option is not
persisted and is effective only when the command opens a new window." ADR-0003 builds on this.

### Scenarios 12–14 evidence and results

On 2026-11-26, a Personas 1.5.0 VSIX built from
`fc43d26512ed403c557c8649b9a0a8f533e80338` was installed in a disposable Windows x64 VS Code
1.148.0 instance. The saved multi-root workspace opened with separate user-data and extensions
directories. The desktop helper could see the window but rejected the window handle on repeated
capture attempts, so that run collected only the evidence outside the window below.

On 2026-11-27, a Personas 1.6.0 VSIX built from
`947b9ab7a8099d3b2d71dfeae783251538e39fbe` passed lint, 584 unit tests and the VS Code integration
suite before installation in a fresh disposable Windows x64 VS Code 1.148.0 instance. A human
completed the real-window checks with copied workspace files and inert test extensions. CLI checks
before and after each profile mutation used the same isolated user-data and extensions directories.

| Scenario | Evidence collected outside the window | Real-window result on 2026-11-27 |
| --- | --- | --- |
| 12. Duplicate workspace candidate IDs | The bounded reader and Matrix model, using two on-disk candidates with the same ID and different display names, produced one row, one duplicate warning and the same display name for both root orders. The probe supplied an empty runtime snapshot. | Passed. Both folder orders produced one `Personas Local Workspace Fixture` row with read-only `—` and `Unknown` cells. The Matrix warned: `Multiple workspace roots contain local extension personas-tests.personas-local-workspace-fixture; the effective runtime location wins.` Reversing the saved workspace's folder order did not change the winning display name. |
| 13. Malformed candidate and profile association | Workspace discovery reported invalid JSON for the malformed manifest and skipped it. Using the sandbox's recorded Default association, an extension installed only in the second profile showed `Not installed in profile` with an empty runtime snapshot. Supplying a string instead of a `profileAssociations` object through the read adapter produced a warning and changed that cell to `Unknown`. The rendered table had no workspace action for that cell. Reading the original association again restored Default. | Passed. An invalid manifest produced a path-specific invalid-JSON warning and no row. A profile-only fixture first showed `Not installed in profile`; changing only the saved workspace association to `missing-personas-profile-id` produced `VS Code associated this workspace with unknown profile id "missing-personas-profile-id"`, changed the workspace cell to `Unknown`, and exposed no hover, click or keyboard mutation action. Restoring the backup removed the warning and returned the cell to `Not installed in profile` without changing profile membership. |
| 14. Existing Matrix actions | The sandbox CLI confirmed profile-specific fixture memberships. The inventory exposed a disk-only fixture seeded after startup as an orphan. Existing unit tests covered profile-cell and bulk-action handling, filters, hover cards and cleanup selection. The VS Code integration suite exited successfully. | Passed with the adjacent observation below. The text filter and clear flow worked, hover cards rendered, a profile-cell uninstall removed an inert fixture from its only profile, and **Remove from all profiles** removed a distinct fixture from both profiles. CLI membership checks matched the Matrix before and after both mutations. The removed fixture became a strikethrough orphan. The cleanup list started unchecked, confirmation named only the selected fixture, cleanup removed its folder, and the row and stale action disappeared. |

After the successful bulk removal, the strikethrough orphan's hover card still offered **Remove from
all profiles**. Invoking it again made no mutation and reported `Not directly installed in any
profile.` This was recorded as adjacent stale-action behavior; it did not invalidate the verified
membership change or selected-folder cleanup.

Start a fresh [isolated sandbox](../local-build-test-and-release.md#install-in-an-isolated-sandbox)
for scenarios 12–14. If reusing the sandbox from scenarios 1–11, uninstall the workspace-local copy
from scenario 10 first. Work only with copied workspace files, test profiles and test extensions.
For the profile checks, package the [inert profile fixture](../../test/fixtures/hello-ext) and a
copy with a distinct manifest `name` and `displayName`.

1. For scenario 12, copy `local-fixture` into the second root's `.vscode/extensions` directory and
   change only the duplicate's `displayName`. Leave both copies uninstalled. Verify one row and the
   duplicate warning, reverse the saved workspace's `folders` list, and verify the same row and name.
2. For scenario 13, add a separate candidate with invalid `package.json` in the copied workspace.
   Refresh and look for the invalid-manifest warning and the skipped candidate. Open the workspace
   in Default with an inert fixture installed only in a second ordinary profile. Confirm the fixture
   shows `Not installed in profile`. Back up the sandbox's `User/globalStorage/storage.json`, then
   set the exact saved workspace association in `profileAssociations.workspaces` to a nonexistent
   profile ID. Preserve the profile registry and other associations. Refresh the Matrix and verify
   the bad value is still on disk before checking the warning and the `Unknown` cell. The workspace
   cell should offer no action. Restore the original association, refresh and confirm recovery.
3. For scenario 14, use an inert local VSIX installed in one profile to test uninstall through a
   profile cell. Preinstall a second local fixture into two ordinary profiles and test **Remove
   from every profile** from its hover card. Use the text filter to find each fixture and clear it
   to restore the other rows. Verify membership before and after both mutations using the sandbox
   CLI with `--list-extensions`. Seed a separate valid extension folder on disk after the sandbox
   starts, without adding it to a profile manifest. VS Code marked the pre-start seed obsolete in
   this run. Verify the cleanup list starts unchecked, the confirmation names only the selected
   test folder, and the folder is gone from the extensions directory after confirmation.

Record the observed UI results against each scenario in this section and issue #167.

## References

- [VS Code 1.89 local workspace extensions](https://code.visualstudio.com/updates/v1_89#_local-workspace-extensions)
- [VS Code stable extensions API](https://code.visualstudio.com/api/references/vscode-api#extensions)
- [VS Code profile association persistence](https://github.com/microsoft/vscode/blob/main/src/vs/platform/windows/electron-main/windowsMainService.ts)
- [VS Code workspace extension management](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensionManagement/common/extensionManagementService.ts)
