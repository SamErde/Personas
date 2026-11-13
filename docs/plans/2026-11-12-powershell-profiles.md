# PowerShell profiles feature plan

**Status:** Implemented on feat/powershell-profiles; review and final validation in progress
**Date:** 2026-11-12

## Goal and terminology (Q1: confirmed)

Help users manage PowerShell profile scripts: files stored in standard locations
that PowerShell loads automatically when starting a session with profile loading
enabled. These scripts customize the shell through variables, helper functions,
module imports, prompts, and other session settings.

Use **PowerShell profile** explicitly to distinguish these scripts from VS Code
profiles. See the root glossary.

Reference: [Microsoft about_Profiles](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles).

## Environment scope and roadmap (Q2: confirmed)

- **Initial release:** Local desktop systems on Windows, macOS, and Linux.
  Retain Personas' current boundary: remote windows, including WSL, are unsupported.
- **Next scope to support:** WSL.
- **Possible later scopes:** SSH and container windows. Neither is committed scope.

WSL support requires a separate design decision about which environment owns the
managed profile files and where discovery and file operations run. This plan does
not yet settle those details.

## Editions and installations (Q3: confirmed)

- Show PowerShell 7 and Windows PowerShell 5.1 in separate edition groups.
- Support PowerShell 7 on Windows, macOS, and Linux.
- Show Windows PowerShell only on Windows; hide its group on other operating systems.
- Include applicable console and VS Code profile scopes in each edition group.
  Include ISE profile scopes only under Windows PowerShell.
- Defer Preview and custom installation discovery from the initial release.

## Profile rows (Q5: confirmed)

Within each edition group, group rows under **Current User** and **All Users**.
Each user-scope group contains **All Hosts**, **Console**, and **VS Code**;
Windows PowerShell also contains **ISE**. This yields six PowerShell 7 rows and
eight Windows PowerShell rows. Tooltips show the full path and standard scope name
with the host explicitly identified.

### Host visibility (Q11: confirmed)

Keep the standard VS Code rows visible. Personas itself runs in VS Code.
Show ISE rows only under Windows PowerShell on Windows; never show them on
macOS or Linux. Do not gate ISE rows on detecting whether ISE is installed.

Clarify in tooltips that the VS Code-specific PowerShell profile is loaded by the
PowerShell extension's Editor Services host. An ordinary pwsh terminal inside
VS Code uses the console-host profile. Row visibility does not claim that a
particular script is currently loaded.

## Discovery strategy (Q6: clarified)

Prefer passive discovery. Launching an installed PowerShell executable at runtime
is not categorically prohibited, but must be a last resort because of potential
latency and endpoint detection and response (EDR) detections. Routine use must not
depend on repeatedly launching PowerShell for discovery.

### Explicit runtime fallback (Q6b: confirmed)

After passive discovery fails, offer **Resolve Using PowerShell...**. Explain
that this action launches PowerShell; never launch it automatically as a fallback.
Run with profiles disabled and a short timeout. Cache successful results for the
session; ordinary refreshes must not launch PowerShell again. Development research
and validation may query PowerShell.

Discover installed editions and profile locations passively using filesystem,
environment, and operating-system folder information. Account for redirected
Windows Documents folders, including OneDrive-managed locations. Distinguish an
unavailable installation, a discovery failure, and a profile file not yet created;
do not offer creation at guessed paths as though they were authoritative.

### Path authority (Q6a: confirmed)

Windows' resolved Documents location takes precedence over conventional and
OneDrive candidate paths, even when another candidate contains an existing
profile. Such files may be stale copies. If the correct destination cannot be
established, show an unresolved status and withhold creation rather than silently
choosing a candidate.

Research: `docs/spikes/powershell-profile-discovery.md`.
The exact Windows folder-resolution mechanism still needs an engineering check.

## File management boundary (Q4: confirmed)

Personas may create and delete PowerShell profile scripts through filesystem
operations. Users edit script contents in the VS Code editor. Managing a file does
not automatically execute it.

This is an explicit exception to ADR-0001's official-CLI requirement for tool state.

## Permissions (Q8: confirmed)

Personas uses its current permissions and does not automatically request elevation
for all-users profiles. Open readable files normally. Explain permission failures
with the affected path. Editing and saving use VS Code's normal behavior.

## Creation and opening (Q7: confirmed)

Existing profile names and edit glyphs open their files in the VS Code editor.
Missing profiles use a muted name with explicit **Not created** text. Selecting
the name or create glyph offers **Create and Open**, showing the destination path.

Only after confirmation, create an empty file and any missing parent directories,
then open the file. Never overwrite an existing file; if another process created
it meanwhile, open that file instead.

## Deletion (Q9: confirmed)

Offer **Delete PowerShell Profile...** in existing profile files' context menus,
including nonempty files. Confirm with the full path. Move the file to
Trash/Recycle Bin and stop if that operation is unavailable; do not fall back to
permanent deletion. Block deletion while the editor has unsaved changes.
Empty files also require confirmation.

### Symbolic links (Q13: confirmed)

Open existing profile links' targets for editing. Show link destinations in
tooltips and deletion confirmations. Deletion removes only the link, never its
target, and is blocked when the target has unsaved edits. If recoverable deletion
of the link cannot be guaranteed, leave deletion unavailable.

Treat broken links as a distinct state. Never overwrite them through Create.

## Supporting actions (Q10: confirmed)

- Automatically refresh file status after external file changes.
- Provide manual Refresh; it does not launch PowerShell.
- Provide Copy Path and Reveal in File Manager.
- Explain profile loading order and that edits apply when a subsequent session
  loads the script. Existence alone must not be labelled active or loaded.
- Provide Help linking to the versionless Microsoft about_Profiles URL above.
- Defer execution/reload actions, templates, and content synchronization.

## Proposed integration

Place a **PowerShell Profiles** section below **Profiles & Extensions** in Home.
Use the existing Home webview and typed host/client protocol, with a separate
PowerShell discovery and file-management service. Resolve actions against the
current host-side inventory rather than accepting arbitrary paths from webview
messages.

Keep discovery and rendering independent of VS Code profile services so missing
VS Code registry data or the code CLI does not suppress otherwise available
PowerShell functionality. Retain the confirmed local-desktop boundary.

## Installation layout (Q12: confirmed)

Research confirms that PowerShell 7 installation types normally share current-user
profile paths for the same user, host, and configuration environment. Stable,
Preview, and .NET tool installations do not inherently create separate
current-user profile namespaces. Windows PowerShell 5.1 has its own current-user
directory.

All-users profiles are relative to each installation's actual PSHOME. A .NET tool
launcher or other shim is not necessarily in PSHOME. MSIX all-users profiles are
not customizable because the package directory is read-only.

Show **Current User** once per edition group, with **All Users** subgroups for
distinct supported installation roots only when multiple roots are discovered.
Installation type is descriptive metadata, not another top-level persona category.
Do not add an installation selector.

The six/eight-row counts above describe one installation per edition; additional
distinct all-users roots add rows. Preview and custom
installation discovery remain deferred as agreed in Q3. Research evidence about
these variants does not expand the approved first-release discovery scope.

All interviewed product decisions are settled. The Windows resolver and
packaging-specific discovery mechanisms remain implementation investigations,
subject to the confirmed passive-first policy and explicit runtime fallback.

## Profile mapping and presentation

For each edition, resolve its current-user directory separately from each
installation's actual PSHOME. Do not infer PSHOME from an executable shim.
Use the platform's actual filename casing rather than assuming a case-insensitive
filesystem.

| User scope | Row | File within its resolved directory | Standard scope name |
| --- | --- | --- | --- |
| Current User | All Hosts | profile.ps1 | CurrentUserAllHosts |
| Current User | Console | Microsoft.PowerShell_profile.ps1 | CurrentUserCurrentHost |
| Current User | VS Code | Microsoft.VSCode_profile.ps1 | CurrentUserCurrentHost |
| Current User | ISE (Windows PowerShell only) | Microsoft.PowerShellISE_profile.ps1 | CurrentUserCurrentHost |
| All Users | All Hosts | profile.ps1 | AllUsersAllHosts |
| All Users | Console | Microsoft.PowerShell_profile.ps1 | AllUsersCurrentHost |
| All Users | VS Code | Microsoft.VSCode_profile.ps1 | AllUsersCurrentHost |
| All Users | ISE (Windows PowerShell only) | Microsoft.PowerShellISE_profile.ps1 | AllUsersCurrentHost |

The table's filenames describe their conventional spelling; validate edition-
specific casing when implementing. Tooltips identify the host as well as the
standard scope name, full path, installation when applicable, and link destination.

For any one host, explain execution order as:
**All Users / All Hosts → All Users / that host → Current User / All Hosts →
Current User / that host**. Console, VS Code, and ISE rows describe different
hosts; they are not three scripts that every session loads in sequence.

Keep existence separate from path resolution, permissions, and link status:

| State | Presentation and available behavior |
| --- | --- |
| Existing file | Open/edit; eligible context-menu actions follow confirmed permission, dirty-editor, and Trash rules. |
| Not created | Muted name plus text and create glyph; Create and Open confirmation at a resolved destination. |
| Unresolved path or unavailable installation | Explain the reason; never offer creation at an invented destination. Offer explicit runtime resolution only when an installed executable is available and passive resolution failed. |
| Inaccessible or invalid file location | Explain the path and failure; do not present this as a missing file. |
| Broken link | Identify the link destination; never overwrite it through Create. Apply link-only recoverable deletion rules if available. |

Show known read-only restrictions separately from existence. Readable existing
MSIX all-users files can be opened, but customization there is unsupported.
A failed permission check must not trigger elevation automatically.

## Service boundaries and refresh

Keep installation discovery, current-user directory resolution, profile inventory,
and file actions separable and testable with injected filesystem/platform adapters.
The inventory records edition, user scope, host, resolved URI or unresolved reason,
installation roots where applicable, and link information. Actions use inventory
identifiers resolved by the extension host; the webview does not choose arbitrary
filesystem destinations.

Group current-user rows by edition and distinct all-users rows by actual
installation root. Preserve profile link paths rather than replacing their
identity with their target paths. Resolve targets separately for editing and
dirty-editor checks.

Use bounded watchers on resolved profile locations and suitable existing parent
directories, debouncing changes. A missing directory must not require creating it
merely to watch it. Refresh on relevant editor/file events and support manual
Refresh as the recovery path for missed events. Dispose watchers with the service.

Refresh passively and update independent failures without replacing the whole
Home view. Keep successful explicit-runtime results in session memory; do not
schedule recurring probes. A fallback failure leaves an actionable unresolved
state, without inventing a path or changing execution policy.

## Implementation sequence

1. Validate passive platform resolvers and standard installation layouts against
   the research, including redirected Documents and real PSHOME resolution.
2. Implement inventory and grouping with injected platform/filesystem adapters.
3. Add independent Home state, rendering, tooltips, help, and passive refresh.
4. Add open/create and supporting context-menu actions.
5. Add recoverable deletion and symbolic-link handling with dirty-editor checks.
6. Add the explicit PowerShell fallback, bounded by a timeout and session cache.
7. Complete automated checks and local-platform manual acceptance below.

## Implementation investigation and validation

Choose and validate the Windows known-folder resolver without routine PowerShell
launches; preserve redirection and distinguish authoritative paths from fallback
candidates. Use the discovery research as the starting evidence.

Validate local Windows, macOS, and Linux discovery, redirected and OneDrive
Documents, Unix XDG paths, supported edition separation, absent installations,
unresolved/inaccessible paths, and standard installation symlinks. Verify that
passive discovery and refresh never launch PowerShell, and that only the explicit
fallback does so, with a timeout and session caching.

Validate create-without-overwrite (including races), missing parent directories,
permission failures, dirty-editor deletion blocking, recoverable deletion,
unavailable Trash/Recycle Bin, external file changes, and keyboard-accessible
actions whose state is not communicated by color alone.

During implementation run the repository checks: `npm run lint`, `npm test`,
and `npm run build`, plus targeted integration checks for the added Home actions
and file lifecycle. Use disposable profile fixtures for destructive-action tests.

The user confirmed the complete design on 2026-11-12. Implementation uses
separate discovery, inventory, file-action, Home-controller, and rendering modules.
No real PowerShell profile was modified during development.

### Implementation notes

- Windows passive Documents resolution reads configured and shell-resolved Personal
  registry values through bounded reg.exe queries. It accepts only matching absolute
  expanded paths. Disagreement or lookup failure leaves the path unresolved and
  offers the explicit PowerShell fallback. Native known-folder equivalence and
  Windows manual acceptance remain to be verified.
- Standard stable installation roots and common executable links are detected.
  Shims whose real PSHOME cannot be established remain unresolved until the user
  explicitly invokes the bounded fallback.
- VS Code's public Trash API does not guarantee recoverable link-only deletion on
  every platform. Linked profiles therefore expose Reveal in File Manager while
  in-extension deletion is unavailable, as allowed by Q13.
- The explicit fallback uses a five-second timeout and a 128 KiB output limit.
- Automated lifecycle tests use disposable temporary files and an injected Trash
  adapter; platform-native Trash and Windows/Linux UI acceptance require manual
  verification.

