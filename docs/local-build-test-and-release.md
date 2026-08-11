# Local build, sandbox testing, and release guide

Use this guide to build Personas, sideload it into a disposable VS Code instance, complete the
manual workspace-status checks, and understand how an accepted change becomes a published
release. Local testing and release publishing are deliberately separate: a local VSIX does not
need a new version, while release-please owns every committed version change.

## Prerequisites

- Node.js 22
- npm
- VS Code 1.90 or newer with the `code` command available in `PATH`
- A PowerShell terminal opened at the repository root

The disposable commands below isolate both VS Code user data and installed extensions. They do not
read or change the profiles or extensions in the normal VS Code installation.

## Build and package

Install exactly the locked dependencies and run the normal quality gates:

```powershell
npm ci
npm run lint
npm test
npm run build
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

$CodeArgs = @(
    '--user-data-dir'
    $UserDataDir
    '--extensions-dir'
    $ExtensionsDir
)

& code @CodeArgs --install-extension $Vsix.FullName --force

$WorkspacePath = (Resolve-Path '.\test\spike\workspace-status.code-workspace').Path
& code @CodeArgs --new-window $WorkspacePath
```

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

To install or launch Personas in a particular disposable profile, add `--profile`:

```powershell
& code @CodeArgs --profile 'Personas Test' --install-extension $Vsix.FullName --force
& code @CodeArgs --profile 'Personas Test' --new-window $WorkspacePath
```

VS Code creates a named profile when a workspace is opened with a profile name that does not yet
exist. All `code` commands used for the sandbox must retain the same `--user-data-dir` and
`--extensions-dir` values.

## Faster development-host loop

For quick UI iterations, build continuously in the repository:

```powershell
npm run watch
```

Then open **Run and Debug**, select **Run Extension**, and press F5. The repository's launch
configuration opens an Extension Development Host with the local source. Use the packaged sandbox
for final acceptance because the development host retains Personas's safety guard and therefore is
not representative of every profile mutation path.

## Manual test scenarios

Trust only the disposable fixture workspace. In the sandbox, open the Personas activity-bar icon
and run **Personas: Show Extension Matrix** if the matrix does not open automatically.

1. Open an empty window and verify that profile cards remain but the Current workspace card and
   matrix column are absent.
2. Open a single folder and verify one read-only Current workspace card and one visually separated
   final matrix column using the folder name.
3. Open `test/spike/workspace-status.code-workspace` and verify that the saved multi-root workspace
   produces one aggregate card and column.
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
12. Introduce duplicate candidate IDs in different workspace roots and verify one deterministic row
    plus a warning.
13. Exercise malformed or unreadable candidate/profile-association data and verify a warning,
    `Unknown`, and no enabled mutation action.
14. Verify that existing profile toggles, bulk actions, filters, hover cards, and orphan cleanup are
    unchanged.

The inert profile fixture can be installed in the same sandbox when an ordinary VSIX is useful:

```powershell
$FixtureVsix = (Resolve-Path '.\test\fixtures\hello-ext\fixture.vsix').Path
& code @CodeArgs --install-extension $FixtureVsix --force
```

Create additional profiles through the VS Code Profiles UI or the `--profile` option. Keep every
test command pointed at the disposable user-data and extension directories.

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

Personas uses conventional commits and release-please:

- `fix:` normally requests a patch release.
- `feat:` normally requests a minor release.
- a breaking conventional commit requests the corresponding breaking release.

For example, a `feat:` release after version `0.8.6` normally becomes `0.9.0`, assuming no other
release-driving commits change the result. Do not apply that number on the feature branch.

The normal publication sequence is:

1. Merge an approved feature or fix PR into `main`.
2. The release-please workflow creates or updates its release PR with the generated changelog and
   coordinated version changes.
3. Review the release PR and confirm that `CHANGELOG.md`, `package.json`, `package-lock.json`, and
   `.release-please-manifest.json` agree.
4. Merge the release PR.
5. The release workflow runs lint, build, unit tests, and disposable integration tests; packages the
   VSIX; attaches it to a draft GitHub release; and publishes the GitHub release.
6. A separate job publishes that exact released VSIX to the VS Code Marketplace. A Marketplace
   failure remains visible without changing the sealed GitHub release.

To require a specific next release version, add a conventional commit containing a
`Release-As: X.Y.Z` footer. Do not hand-edit the version files to force it. Use manual Marketplace
publication only as the explicit recovery procedure documented in the release workflow after a
Marketplace job failure; it is not the normal publishing path.

## Cleanup

When testing is complete, close every VS Code window launched with the disposable arguments. The
entire sandbox is under the unique path stored in `$TestRoot`; inspect that value before removing
the directory. The packaged VSIX files under `releases` are gitignored and may be retained for
additional local testing.
