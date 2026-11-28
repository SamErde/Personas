# Local build, sandbox testing, and release guide

Use this guide to build Personas, sideload it into a disposable VS Code instance, complete the
manual workspace-status checks, and understand how an accepted change becomes a published
release. Local testing and release publishing are deliberately separate: a local VSIX does not
need a new version, while release-please owns every committed version change.

## Prerequisites

- Node.js, the version pinned in `.nvmrc`
- npm
- VS Code 1.101 or newer with the `code` command available in `PATH`
- A PowerShell terminal opened at the repository root

The disposable commands below isolate both VS Code user data and installed extensions. They do not
read or change the profiles or extensions in the normal VS Code installation.
The required `engines.vscode: ^1.101.0` declares a minimum, not a cap on later 1.x
releases. Keep `@types/vscode` on the 1.101 API line while this is the minimum:
compiling against those types checks that extension code does not depend on newer
VS Code APIs. VS Code 1.101 runs its extension host on Node.js 22, so `@types/node`
stays on the 22 line. CI runs the integration suite on the latest stable release on Linux,
Windows, and macOS, and on 1.101.0 on Linux and Windows. That does not establish runtime
compatibility with every release in between.
If the minimum changes, update the engine, both types ranges, the CI minimum-engine job,
and the Dependabot ignore rules together after testing.

## Build and package

Install exactly the locked dependencies and run the normal quality gates. `test:integration` builds
`dist/` first; use `test:integration:prebuilt` to rerun the suite against an existing build:

```powershell
npm ci
npm run lint
npm test
npm run test:integration
git diff --check
```

Create a local VSIX:

```powershell
npm run package
```

The package script runs the extension's `vscode:prepublish` build and writes a versioned VSIX to
the gitignored `releases` directory. Locate the newest package without assuming its version:

```powershell
$Vsix = Get-ChildItem -LiteralPath .\releases -Filter 'personas-*.vsix' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

$Vsix | Select-Object FullName, Length, LastWriteTime
```

## Install in an isolated sandbox

Create unique temporary user-data and extension directories, install the VSIX, and open the saved
multi-root fixture:

```powershell
$TestRoot = Join-Path $env:TEMP ('personas-manual-' + [guid]::NewGuid().ToString('N'))
$UserDataDir = Join-Path $TestRoot 'user-data'
$ExtensionsDir = Join-Path $TestRoot 'extensions'

New-Item -ItemType Directory -Force -Path $UserDataDir, $ExtensionsDir | Out-Null

$WorkspaceFixtureDir = Join-Path $TestRoot 'workspace-fixture'
New-Item -ItemType Directory -Force -Path $WorkspaceFixtureDir | Out-Null
Copy-Item -LiteralPath .\test\fixtures\multi-root-workspace\workspace-status.code-workspace -Destination $WorkspaceFixtureDir
Copy-Item -LiteralPath .\test\fixtures\multi-root-workspace\workspace-root -Destination $WorkspaceFixtureDir -Recurse -Force
Copy-Item -LiteralPath .\test\fixtures\multi-root-workspace\workspace-root-two -Destination $WorkspaceFixtureDir -Recurse -Force
$WorkspacePath = Join-Path $WorkspaceFixtureDir 'workspace-status.code-workspace'

$CodeArgs = @(
    '--user-data-dir'
    $UserDataDir
    '--extensions-dir'
    $ExtensionsDir
)

& code @CodeArgs --install-extension $Vsix.FullName --force

& code @CodeArgs --new-window $WorkspacePath
```

The copied fixture preserves the saved workspace's relative folder layout. Make every manual
fixture change only under `$WorkspaceFixtureDir`; the tracked files under `test/fixtures/multi-root-workspace` remain
unchanged.

Installing the same version again with `--force` replaces the sandbox copy, so ordinary local
testing does not require a version bump. After making another build:

```powershell
npm run package

$Vsix = Get-ChildItem -LiteralPath .\releases -Filter 'personas-*.vsix' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

& code @CodeArgs --install-extension $Vsix.FullName --force
```

Run **Developer: Reload Window** in the sandbox after reinstalling.

### Sandbox profiles

Create sandbox profiles in the sandbox window's Profiles editor.

Opening the sandbox with `--profile` and a name that does not exist yet can also create a profile,
but only when no sandbox window is open, so it creates at most one profile per launch. In testing
on Windows with VS Code 1.147.0, a `--profile` launch made while a sandbox window was already open
created no profile, and later `--install-extension --profile` calls failed with
`Profile '<name>' not found`. Whether other platforms or versions behave the same way is not
verified.

Before installing into a profile, check that the command line can see it:

```powershell
& code @CodeArgs --profile 'Personas Test' --list-extensions
```

If the command reports that the profile is not found, create it in the Profiles editor first. Then
install or launch Personas in that profile:

```powershell
& code @CodeArgs --profile 'Personas Test' --install-extension $Vsix.FullName --force
& code @CodeArgs --profile 'Personas Test' --new-window $WorkspacePath
```

All `code` commands used for the sandbox must retain the same `--user-data-dir` and
`--extensions-dir` values.

## Repeatable UI iteration

The **Run Extension** F5 configuration deliberately leaves Personas' development-host safety guard
enabled. It has no build task, so run `npm run build` (or keep `npm run watch` running) first. It is useful for verifying that guard, but it does not load the functional Personas UI. For
UI iteration, keep the supported packaged sandbox open instead:

```powershell
npm run watch
```

Keep the watch process running in a separate terminal. After each completed build, run the following
in another terminal to package the new output, refresh `$Vsix`, and reinstall it in the sandbox:

```powershell
npm run package

$Vsix = Get-ChildItem -LiteralPath .\releases -Filter 'personas-*.vsix' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

& code @CodeArgs --install-extension $Vsix.FullName --force
```

Then run **Developer: Reload Window** in the sandbox. This keeps both the VS Code state and fixture
workspace disposable while exercising the same production-host safety behavior that users receive.

## Manual test scenarios

Trust only the disposable fixture workspace. In the sandbox, open the Personas activity-bar icon
and run **Personas: Open Extension Matrix** if the matrix does not open automatically.

1. Open an empty window and verify that the VS Code Profiles view still lists every profile, but the
   Current workspace card and matrix column are absent.
2. Open a single folder and verify one read-only Current workspace card and one visually separated
   final matrix column using the folder name.
3. Open `$WorkspacePath` and verify that the saved multi-root workspace produces one aggregate card
   and column.
4. Verify that **Open manifest** opens the saved `.code-workspace` file read-only and **Edit
   manifest** opens the same host-owned file for editing.
5. Install a normal extension in the active profile and verify `Enabled` when VS Code exposes it in
   the current window.
6. Select **Disable (Workspace)** for that extension, follow VS Code's restart or reload prompt, and
   verify `Not enabled`. Personas must not claim an exact disable reason.
7. Disable an extension globally, select **Enable (Workspace)**, reload when prompted, and verify
   `Enabled`.
8. Verify `Not installed in profile` for an extension that is present in another profile but absent
   from the known active profile.
9. Before installation, verify that `.vscode/extensions/local-fixture` appears as an `Unknown`
   workspace-local candidate rather than as installed.
10. Open the Extensions view, find the local fixture under **Workspace Recommendations**, install
    it, and verify a workspace-only row with `Workspace-local` status.
11. Verify that a workspace-only row has no profile cell toggles or profile bulk actions.
Scenarios 12–14 passed a real-window run on 2026-11-27. See the
[fixture setup and results](spikes/workspace-extension-status.md#scenarios-1214-evidence-and-results)
before repeating them ([#167](https://github.com/SamErde/Personas/issues/167)).

12. Introduce duplicate candidate IDs in different workspace roots and verify one deterministic row
    plus a warning.
13. Exercise malformed or unreadable candidate/profile-association data and verify a warning,
    `Unknown`, and no enabled mutation action.
14. Verify that existing profile toggles, bulk actions, filters, hover cards, and orphan cleanup are
    unchanged.
15. Hover over and tab through matrix cells. Verify that the row and column are highlighted, with
    stronger emphasis on the column header and the extension name. Check a light, a dark, and both
    high-contrast themes, where the labels get an outline.
16. Click an `Enabled`, `Not enabled`, or `Workspace-local` cell in the Current workspace column.
    Verify that the Extensions view shows that extension along with an info message, and that the
    `—` and `?` cells are not buttons.
17. Add several profiles or narrow the window until the matrix scrolls sideways. Verify that the
    extension names stay pinned, with their row dividers, and that the top-left header stays on top
    when you scroll both ways.

The scenarios below cover the sidebar views.

18. **VS Code Profiles.** Verify the profile order (Default, then the Agents window profile, then the
    rest by name), each profile's direct and applied-to-all counts, that **✎** opens the profile's
    raw extension list, and that **Open Extension Matrix** opens the matrix. Turn
    `personas.showAgentsWindowProfile` off and verify the Agents window profile disappears from the
    view and the matrix.
19. **Opening the matrix with the sidebar.** With `personas.extensionMatrix.openWithSidebar` on,
    showing the VS Code Profiles view opens the matrix, including on window restore. Turn it off and
    verify it doesn't. Set only the legacy `personas.openMatrixOnActivityBarClick` to `false` and
    verify it is honored.
20. **Title bars and settings.** Every view shows the settings gear and no `...`. Git
    Configuration's actions appear on hover or focus, and always with
    `workbench.view.alwaysShowHeaderActions` on. Starting from Settings left on the Workspace tab
    with `workbench.settings.editor` set to `json`, the gear opens graphical User Settings filtered
    to `@ext:SamErde.personas`.
21. **View sizes.** In a workspace that has never shown the sidebar, the views split about 5/3/2.
22. **PowerShell Profiles, files.** Select a missing profile and confirm Create and Open. Then check
    Copy Path, Reveal in File Manager, and Delete PowerShell Profile… (Move to Trash), which must refuse while the file has
    unsaved edits. A linked profile can be opened, but not trashed through the link.
23. **PowerShell Profiles, discovery.** With runtime discovery on, verify the view first renders
    passive results, shows **Resolving profile locations…**, and then updates without blocking the
    other views. Force one probe to fail, verify watcher refreshes do not retry it, then verify
    **Run … to resolve** retries only that installation and **Refresh PowerShell Profiles** retries
    all failures. Turn runtime discovery off and verify no PowerShell process starts; on Windows,
    verify the registry fallback. Also turn off `personas.powerShellProfiles.includeWindowsPowerShell`,
    with and without a workspace override.
24. **PowerShell help.** Open help from the **?** and from the Command Palette, also with the view
    collapsed, in both `window.dialogStyle` values. Check that Open PowerShell Settings, Profiles on
    Microsoft Learn, Cancel, Esc, and the X (where shown) each behave as expected, and that help
    doesn't reveal or expand the view.
25. **Git Configuration.** In a repository with a global identity and an `includeIf` file, verify the
    repository name in the title, `user.name` and `user.email` with their sources, and the Applied,
    Not applied here, Empty, and Missing statuses. Check that each file's open button opens it.
    Check that **Show Effective Git Configuration** opens a read-only document. Check the no-repository
    view, Git missing from `PATH`, and `git.path`.

Additional experimental scenario:

- **Apply to all profiles (Experimental).** With experimental features enabled (the default),
  install the inert fixture in the active profile and confirm its hover card offers both the
  experimental action and **Use VS Code instead…**. Cancel once and verify no state change. Then
  confirm, verify the row gains the **ALL** badge, and verify its hover card no longer offers the
  experimental action while **Change in VS Code…** remains available. Turn
  `personas.experimentalFeatures.enabled` off and verify the experimental action remains absent
  while **Change in VS Code…** still opens the native Extensions view. Repeat with
  a deliberately unavailable/ineligible target and verify Personas uses the native hand-off.

The inert profile fixture can be installed in the same sandbox when an ordinary VSIX is useful. It
isn't committed: `npm run test:integration` packages it, or package it yourself first:

```powershell
Push-Location .\test\fixtures\hello-ext
node ..\..\..\node_modules\@vscode\vsce\vsce package --allow-missing-repository --out fixture.vsix
Pop-Location
$FixtureVsix = (Resolve-Path '.\test\fixtures\hello-ext\fixture.vsix').Path
& code @CodeArgs --install-extension $FixtureVsix --force
```

Create additional profiles in the sandbox's Profiles editor, as described in
[Sandbox profiles](#sandbox-profiles). Keep every test command pointed at the disposable user-data
and extension directories.

## Local package versus published package

`npm run package` is safe for local testing. It builds a VSIX with the version already present in
`package.json` and does not publish it. Reinstall that package with `--force` as many times as
needed.

Do not use any of the following as part of normal development or release preparation:

- `npm version`
- manual edits to `package.json`, `package-lock.json`, or `.release-please-manifest.json`
- `vsce publish`, including `vsce publish patch`, `minor`, or `major`
- manual Git tags or manually created replacement GitHub releases

## Versioning and publishing

Releases are automated with [release-please](https://github.com/googleapis/release-please) and
driven by conventional commits: commits merged to `main` accumulate into a bot-managed release PR
that maintains `CHANGELOG.md` and the version bump.

- `fix:` normally requests a patch release.
- `feat:` normally requests a minor release.
- a breaking conventional commit requests the corresponding breaking release.

For example, a `feat:` release after version `1.0.1` normally becomes `1.1.0`, assuming no other
release-driving commits change the result. Do not apply that number on the feature branch.

The normal publication sequence is:

1. Merge an approved feature or fix PR into `main`.
2. The release-please workflow creates or updates its release PR with the generated changelog and
   coordinated version changes.
3. Review the release PR and confirm that `CHANGELOG.md`, `package.json`, `package-lock.json`, and
   `.release-please-manifest.json` agree.
4. Merge the release PR.
5. The release workflow runs lint, build, unit tests, and disposable integration tests (on Linux);
   packages the VSIX; attaches it to a draft GitHub release; and publishes the GitHub release.
6. A separate job publishes that exact released VSIX to the VS Code Marketplace using the
   `VSCE_PAT` repository secret. A Marketplace failure remains visible without changing the sealed
   GitHub release.

To require a specific next release version, add a conventional commit containing a
`Release-As: X.Y.Z` footer. Do not hand-edit the version files to force it.

### Recovering a failed Marketplace publish

A failed `publish-marketplace` job is the usual symptom of an expired `VSCE_PAT`; rotate the secret
before it expires. To recover, re-run that job from the GitHub Actions UI. This is the supported
path, and it publishes the same sealed VSIX.

If re-running the job is not possible, the maintainer may publish the already-released VSIX by hand
as a last resort: check out the release tag, run `npm ci`, download the VSIX from the GitHub
release, and run `npx --no -- vsce publish --packagePath <file>`. This publishes with the vsce version
locked in `package-lock.json`, as the workflow does. This is the only exception to the "never run
`vsce publish` manually" rule. It must use `--packagePath` with the released file (never a version
argument such as `patch`, which bumps and publishes a version release-please does not know about),
and an agent must not run it.

### Realigning release-please after drift (maintainer only)

If versions were ever published outside release-please (for example, a manual `vsce publish patch`
in July 2026), the manifest, tags, and GitHub releases drift apart. release-please then opens bogus
PRs that re-collect history or roll the version backward. To realign, the maintainer sets
`.release-please-manifest.json` `"."` to the **actually published** version that has a matching
`vX.Y.Z` tag, merges that, and if needed adds a `Release-As: X.Y.Z` footer for the next version.
This is the only time the manifest is edited by hand, and an agent never does it.

## Cleanup

When testing is complete, close every VS Code window launched with the disposable arguments. The
entire sandbox is under the unique path stored in `$TestRoot`; inspect that value before removing
the directory. The packaged VSIX files under `releases` are gitignored and may be retained for
additional local testing.

Stop integration runs and close their VS Code windows before cleanup. Preview the eligible
directories and their estimated file sizes, then add `--force` to remove them.

```powershell
npm run clean
npm run clean -- --force
```

Cleanup removes the entire generated `dist/` and `out-test/` directories. Under
`.vscode-test/` it recognizes desktop release, Insiders and commit-pinned installations.
It keeps the `engines.vscode` minimum and the current stable release for every platform.
Unknown cache entries and linked installs are left in place.

If the stable release list is unavailable or invalid, cleanup keeps the minimum and the
newest numeric release with a regular `is-complete` marker for each platform. A platform
with no confirmed complete release keeps all its installs. The integration runner can still
try to download a newer, incomplete minimum even when an older complete copy is available.

Cleanup holds the selected directories open while sizing and removing their contents.
On Linux and macOS it operates from directory descriptors. On Windows it holds handles
that prevent the directories from being renamed or replaced. The Node-only CLI uses the
Koffi development dependency for these OS calls. Cleanup skips linked or malformed roots
and excludes nested link destinations from size estimates. If it cannot inspect a completion
marker, it skips that platform. If it cannot inspect or remove a target, it reports the
error, continues with independent targets and
exits nonzero. The summary counts only successfully listed or removed targets.
