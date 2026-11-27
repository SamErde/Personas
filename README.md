# Personas

<img src="assets/brand/banner.png" alt="Personas: see and manage your developer personas in one sidebar" width="100%" />

**See and manage your developer personas in one sidebar:** VS Code profiles and their extensions, PowerShell profiles, and the Git identity in effect.

If you keep separate setups for different devopment stacks, work/person pronects, ogging, or data science work, each one is a persona: a VS Code profile with its own extensions, a Git identity, and maybe a PowerShell profile. Personas puts them together in the VS Code Activity Bar. You can see what each setup contains and change it in one place, without switching profiles or opening config files to find out what's set where.

![The Personas sidebar beside the Extension Matrix, comparing four VS Code profiles](docs/images/overview.png)

## Features

### Extension Matrix: every profile side by side

- Each profile is a column and each extension is a row. Check or clear a cell to install or uninstall that extension in that profile.
- Hover over an extension's name for its details and quick actions: **Install in every profile**, **Remove from every profile**, and **Apply to all profiles…**.
- Search; filter by category, publisher, or install source; and group by name or publisher.
- A **Current workspace** column shows whether each extension is enabled in the open folder or workspace.
- Find orphaned extensions, which are still on disk but in no profile, and move their version folders to the Trash.

![Extension Matrix filters with counts for category, publisher, and install source](docs/images/matrix-filters.png)

### VS Code Profiles

- See every profile, with how many extensions are installed in it directly and how many are applied to all profiles.
- A **Current workspace** card summarizes the extension status of the open folder or workspace.

### PowerShell Profiles

- Your PowerShell profile scripts, grouped by edition and listed in the order PowerShell loads them.
- Open, create, copy the path of, reveal, or move a profile script to the Trash.

### Git Configuration

- The `user.name` and `user.email` in effect for the current repository, and the file each one comes from.
- The system, global, local, and worktree config files, with every `include` and `includeIf` file and whether it applies here.
- **Show Effective Git Configuration** lists every value in the order Git reads it.

<img src="docs/images/sidebar.png" alt="The Personas sidebar with the VS Code Profiles, PowerShell Profiles, and Git Configuration views" width="360" />

## Getting started

1. Install **Personas** from the Visual Studio Marketplace.
2. Select the Personas icon in the Activity Bar. The sidebar opens, and so does the Extension Matrix.
3. Check or clear a cell in the matrix to install or uninstall an extension in that profile.
4. Look at the PowerShell Profiles and Git Configuration views to see the rest of your setup.

The [user guide](docs/user-guide.md) covers every feature in detail.

## Settings

Select the gear in any Personas view's title bar, or run **Personas: Open Personas Settings**, to open Settings filtered to Personas.

| Setting | Default | What it does |
| --- | --- | --- |
| `personas.extensionMatrix.openWithSidebar` | `true` | Open the Extension Matrix whenever the VS Code Profiles view is shown. |
| `personas.showAgentsWindowProfile` | `true` | Show VS Code's Agents window profile, which uses the Default profile's extensions. |
| `personas.powerShellProfiles.includeWindowsPowerShell` | `true` | On Windows, include Windows PowerShell 5.1 and ISE profiles. |
| `personas.powerShellProfiles.allowRuntimeDiscovery` | `false` | Let you start PowerShell to find a profile location that can't be found otherwise. This is a machine setting, so set it in User settings. |

## Learn more

- [User guide](docs/user-guide.md)
- [Roadmap](docs/roadmap.md)
- [Changelog](CHANGELOG.md)
- [Report an issue or suggest a feature](https://github.com/SamErde/Personas/issues)
- [Contributing](CONTRIBUTING.md)
