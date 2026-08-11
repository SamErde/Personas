# Spike — current workspace extension status

**Date:** 2026-08-10
**Machine:** Windows 11 x64
**VS Code lines:** 1.90.2 (minimum supported line) and 1.132.0 (current Stable)
**Harness:** `scripts/spike-workspace-status.mjs`

## Boundary and setup

The probe used only stable `vscode.workspace` and `vscode.extensions` APIs, the documented VS Code CLI, and read-only inspection of `globalStorage/storage.json`. Each run created separate temporary `--user-data-dir` and `--extensions-dir` directories. It opened only the fixtures under `test/spike`; it did not read or change the user's VS Code data.

Run:

```text
node scripts/spike-workspace-status.mjs 1.90.2 stable
```

The fixture set included:

- an ordinary inert profile extension;
- an inert browser-only extension with `extensionKind: ["workspace"]`;
- a development extension with `extensionKind: ["ui"]` that captured API snapshots;
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

The uninstall/reinstall portion used the public CLI rather than workspace enablement controls. It therefore verifies the stable API's positive/negative visibility and change-event behavior, but it does not identify why an installed extension is absent. The UI must say `Not enabled`, not `Disabled (Workspace)` or any other exact disable reason.

## Profile association finding

Extension-development and extension-test windows intentionally do not persist workspace/profile associations. Both versions therefore left `profileAssociations.workspaces` empty even when launched with `--profile`, while still creating the named profile. This is a property of the development host, not evidence that production windows omit associations.

Current VS Code source makes the distinction explicit: normal windows call `setProfileForWorkspace`, whereas windows with `extensionDevelopmentPath` skip persistence. The persisted map uses the exact folder or `.code-workspace` URI string as its key and the profile ID as its value; the default ID is `__default__profile__`.

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

The following UI checks remain manual because the app-control helper was unavailable:

- Disable (Workspace), re-enable, and observe the refresh/restart flow;
- install the local candidate from the Workspace Recommendations view and confirm the public runtime URI; and
- exercise the final Personas activity card and matrix states after implementation.

Until those checks are completed, the implementation fails closed exactly as described above and exposes `Unknown` for insufficient evidence.

## References

- [VS Code 1.89 local workspace extensions](https://code.visualstudio.com/updates/v1_89#_local-workspace-extensions)
- [VS Code stable extensions API](https://code.visualstudio.com/api/references/vscode-api#extensions)
- [VS Code profile association persistence](https://github.com/microsoft/vscode/blob/main/src/vs/platform/windows/electron-main/windowsMainService.ts)
- [VS Code workspace extension management](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensionManagement/common/extensionManagementService.ts)
