# Personas

<img src="assets/brand/banner.png" alt="Personas banner" width="100%" />

Easily manage your dev personas: the different Git identities, VS Code profiles, and extensions that you need in different contexts.

## Features

Personas brings your VS Code profiles and their extensions together in one view. The Extension Matrix shows every profile side by side, so you can compare, install, and remove extensions without switching between them, and search, filter, or group the list to find what you need. Distinct cell symbols, controls that match VS Code in every theme (including high contrast), and full keyboard and screen reader support make it comfortable to use, and it holds your place and your view as you work. The Personas Home sidebar opens the matrix and also lists your PowerShell profile scripts, so you can open, create, or remove them in one place.

- **Every profile in one place**: Each profile is a column and each extension is a row. Check or clear a cell to install or uninstall that extension in that profile. Profiles appear in the same order on Home and in the matrix: Default first, then the Agents window profile if you have one, then the rest in natural order.
- **Find extensions fast**: Search by name, ID, or publisher, or show only the extensions applied to all profiles. **Filters** narrow the list by category, publisher, and install source (Marketplace, VSIX, Other, or Unknown). Each choice shows how many extensions it would match, and active filters appear as chips you can remove one at a time.
- **Group by name or publisher**: Arrange rows under A–Z or publisher headings, each with its count.
- **Readable at a glance**: Every cell state has its own symbol as well as its color (◆ applied to all profiles, ⤷ installed through Default, ✓ installed but locked, — not installed, ? unknown), and the **Legend** button explains them.
- **Keyboard and screen reader friendly**:
  - The row and column under the pointer or keyboard focus are highlighted, and extension names stay in view when the matrix scrolls sideways.
  - Focus stays where you left it when the matrix updates.
  - Screen readers announce each cell's extension, profile, and state, and the number of results as you filter.
  - Your view, filters, and grouping last for the rest of the VS Code session.
- **Current workspace status**: When a folder or workspace is open, a separate column reports `Enabled`, `Not enabled`, `Not installed in profile`, `Workspace-local`, or `Unknown` from supported VS Code evidence. Select an `Enabled`, `Not enabled`, or `Workspace-local` cell to open the extension in VS Code's Extensions view, where you can enable or disable it for the workspace.
- **Local workspace extensions**: Valid unpacked extensions under `.vscode/extensions` appear as candidates, including ones that exist only in the workspace. Personas calls one installed only when VS Code reports that exact local path as effective.
- **Orphan cleanup**: Extension versions on disk that no profile references appear struck through under **All**. **Review N orphaned…** lists them with their size and last-modified date, and moves the ones you choose to the Trash or Recycle Bin.
- **A sidebar you can arrange**: Home, the Personas sidebar, has one view per area: **VS Code Profiles**, **PowerShell Profiles**, and **Git Configuration**. Collapse, reorder, or hide them as you would any VS Code view. Showing VS Code Profiles also opens the Extension Matrix; turn that off with the `personas.extensionMatrix.openWithSidebar` setting. Collapsing the view stops it too, but only while another view is shown too: when you hide the others, VS Code expands the one view that is left and removes its header, so it can no longer be collapsed.
- **PowerShell profiles**: Your profile scripts are grouped by PowerShell edition and listed in the order PowerShell loads them. [More about PowerShell profiles](#powershell-profiles).
- **Git configuration**: See the Git identity in effect for the current repository, and which config file each value comes from. [More about Git configuration](#git-configuration).
- **Privacy**: Personas never collects or transmits any data.

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

## Git configuration

Home, the Personas sidebar, includes a Git Configuration view. It answers one
question: which Git configuration is in effect here, and where does it come
from? The current repository is the one that contains the file in the active
editor, or else the first workspace folder; its name appears in the view's
title.

The view lists the effective `user.name` and `user.email` with the file each
comes from, then the system, global, local, and worktree config files that hold
values. Every `include` and `includeIf` target is nested under the file that
names it, with the condition as written and a status:

- **Applied**: Git takes values from the file for the current repository.
- **Not applied here**: the file has values, but none are in effect.
- **Empty**: the file exists and holds no values.
- **Missing**: the file does not exist.

Personas reads the status from Git's own output and does not evaluate
conditions itself. Because of that, a file that two rules include shows the
same status under both. With no repository open, the view shows system and
global configuration only and gives no status for `includeIf` rules.

Each file has an open button that opens it in the editor, where you edit and
save it yourself. Personas never writes a Git config file, and does not create
or delete one. **Show Effective Git Configuration** in the view's title bar
opens a read-only document of every value in the order Git reads it, grouped by
key, each with its scope and source file. It has the same content as
`git config --list`, so treat it with the same care if your config holds
credentials.

The view uses the `git` command: the one VS Code's `git.path` setting names, or
else the one on your `PATH`. It works in local desktop windows only.

## PowerShell profiles

Home, the Personas sidebar, includes a PowerShell Profiles view. It lists the
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
When a location cannot be resolved, the view says so and offers to run the
detected executable (for example, "Run pwsh.exe to resolve"). That action
launches it once with profiles disabled and a five-second timeout. Successful
results are cached for the session. The Refresh and Help buttons are in the
view's title bar: Refresh never launches PowerShell, and Help opens Microsoft's
about_Profiles documentation.

This feature currently supports local desktop windows. WSL is the next planned
scope; SSH and container windows may follow. Preview and custom installations,
profile execution/reload, templates, and content synchronization are deferred.
