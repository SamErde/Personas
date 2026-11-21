# Personas

<img src="assets/brand/banner.png" alt="Personas banner" width="100%" />

Easily manage your dev personas: the different Git identities, VS Code profiles, and extensions that you need in different contexts.

## Features

Easily see and manage which extensions are installed in each VS Code profile, and compare them with
the effective extension status of the current workspace, all from the Extension Matrix. Open it
from the **VS Code Profiles** section of the Personas Home sidebar.

- **Profile x extension matrix**: Show every profile as a column and every extension as a row. Toggle any cell to install or uninstall the extension for that profile. Profiles appear in the same order on Home and in the matrix: Default, then the Agents window profile, then the rest in natural order.
- **Find extensions fast**: Search by extension name, ID, or publisher. Switch between **All** extensions and those **Applied to all profiles**, then narrow further with **Filters** by category, publisher, and install source (Marketplace, VSIX, Other, or Unknown). Each filter value shows how many extensions it would match, and active filters appear as removable chips.
- **Group by name or publisher**: Arrange rows under A–Z or publisher headings, each with its count.
- **Readable at a glance**: Each cell state has its own symbol as well as its color (◆ applied to all profiles, ⤷ installed through Default, ✓ installed but locked, — not installed, ? unknown), explained in a **Legend** panel that opens from the matrix toolbar.
- **Easy to navigate**: The row and column under the pointer or keyboard focus are highlighted, and the extension names stay in view when a wide matrix scrolls sideways. Keyboard focus stays in place when the matrix updates, screen readers announce each cell's extension, profile, and state, and the result count is announced as you filter. Your view, filters, and grouping are kept for the rest of the VS Code session.
- **Current workspace status**: When a folder or workspace is open, a visually separate column reports `Enabled`, `Not enabled`, `Not installed in profile`, `Workspace-local`, or `Unknown` from supported VS Code evidence. Clicking an `Enabled`, `Not enabled`, or `Workspace-local` cell opens the extension in VS Code's Extensions view, where you can enable or disable it for the workspace.
- **Local workspace extensions**: Valid unpacked extensions under `.vscode/extensions` appear as candidates, including workspace-only rows. Personas calls one installed only when VS Code reports that exact local path as effective.
- **Cross-profile install/uninstall**: Act on any profile directly from the matrix; you never have to switch into a profile just to add or remove an extension from it.
- **Orphan cleanup**: Find extension versions on disk that no profile references, review them (size, last modified), and move them to the Trash/Recycle Bin. Orphaned extensions appear struck through under **All**, and a **Review N orphaned…** button opens the cleanup view whenever any exist.
- **Privacy**: This extension never collects or transmits any data.

## Requirements & Limitations

- VS Code Stable or Insiders 1.101 or newer, on Windows, macOS, or Linux.
- Portable installations and custom `--user-data-dir`/`--extensions-dir` are supported.
- Remote workspaces (SSH, WSL, containers, github.dev) are not managed. Personas manages the local desktop install it runs in.

## Profiles, workspaces, and recommendations

Ordinary Marketplace and VSIX extensions are installed per VS Code profile. VS Code can then
enable or disable an installed extension globally or for the current workspace. Personas keeps
those concepts separate: profile columns remain editable installation manifests, while the
**Current workspace** card and matrix column report effective status without changing enablement.
To change it, the matrix hands off to VS Code's own "Enable (Workspace)" / "Disable (Workspace)"
actions, because no official CLI saves workspace enablement.

A saved `.code-workspace` file is shareable JSON configuration. Its Current workspace card can
open a read-only preview or edit that manifest directly. VS Code's internal extension-enablement
state is not stored in that file, so those manifest actions do not enable, disable, install, or
remove extensions.

VS Code also supports local workspace extensions under `.vscode/extensions`. Merely placing an
unpacked manifest there creates a candidate, not proof of installation. Personas reports
`Workspace-local` only when the stable VS Code API exposes the same extension ID from inside that
candidate directory. A candidate without that evidence remains `Unknown`.

Extension recommendations in `.vscode/extensions.json` or a `.code-workspace` file are suggestions
only. Personas never treats a recommendation as installed or enabled. `Unknown` likewise means the
stable APIs or readable profile data cannot support a stronger claim; it is not a guessed disable
or install state.

## How It Works

Personas reads the same files VS Code itself maintains: the profile registry and each profile's extension list. All installs and uninstalls run through the official `code` command-line interface, scoped to the right profile (and, when applicable, the right `--user-data-dir`/`--extensions-dir`). Workspace status additionally uses the stable `vscode.extensions` API and a bounded read-only scan of immediate child directories under each local workspace root's `.vscode/extensions` folder. Personas does not read or write VS Code's SQLite state.

## PowerShell profiles

The Personas Home sidebar includes a PowerShell Profiles section. It lists the
PowerShell profiles that exist, grouped by edition and labeled by host and
scope, in the order PowerShell loads them. Locations that have no script yet
fold into one collapsed line per edition. PowerShell 7 is supported on Windows,
macOS, and Linux; Windows PowerShell and ISE rows appear only on Windows.
Current-user files are listed once per edition, while distinct installations
have separate all-users paths.

Select a row to open its script in the editor, or to confirm Create and Open
for a missing file. Each row's menu offers Copy Path, Reveal in File Manager,
and confirmed deletion to Trash/Recycle Bin. Deletion stops for unsaved edits
or unavailable Trash. Linked profiles can be edited, but use the file manager
to remove a link: the extension cannot guarantee link-only Trash behavior on
every platform.

Discovery is passive by default and respects redirected Documents information.
When a location cannot be resolved, the section says so and offers to run the
detected executable (for example, "Run pwsh.exe to resolve"). That action
launches it once with profiles disabled and a five-second timeout. Successful
results are cached for the session. Refresh never launches PowerShell. Help
opens Microsoft's about_Profiles documentation.

This feature currently supports local desktop windows. WSL is the next planned
scope; SSH and container windows may follow. Preview and custom installations,
profile execution/reload, templates, and content synchronization are deferred.
