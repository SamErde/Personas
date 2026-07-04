# Profile Extension Manager

<img src="assets/brand/banner.png" alt="Profile Extension Manager banner" width="100%" />

See and manage which extensions are installed in which VS Code profiles, all from one convenient matrix.

## Features

- **Extension × profile matrix** — every profile as a column, every extension as a row. Toggle any cell to install or uninstall in that profile without switching profiles.
- **Cross-profile install/uninstall** — act on any profile directly from the matrix; you never have to switch into a profile just to add or remove an extension from it.
- **`ALL` badge for native "apply to all profiles" extensions** — extensions VS Code itself has flagged via its native "Apply Extension to all Profiles" option are badged `ALL`, kept visually distinct from extensions that merely happen to be installed in every profile individually.
- **Orphan cleanup** — find extension versions on disk that no profile references, review them (size, last modified), and move them to the Recycle Bin/Trash. Nothing is ever deleted without your explicit confirmation.
- **Privacy** - This extension never collects or transmits any data.

## How it works

Profile Extension Manager reads the same files VS Code itself maintains — the profile registry and each profile's extension list — to build the matrix. All installs and uninstalls run through the official `code` command-line interface, scoped to the right profile (and, when applicable, the right `--user-data-dir`/`--extensions-dir`). It never writes to VS Code's internal state files.

## Requirements & limits (v1)

- VS Code Stable or Insiders, desktop, on Windows, macOS, or Linux.
- Portable installations and custom `--user-data-dir`/`--extensions-dir` are supported.
- Remote workspaces (SSH, WSL, Containers, github.dev) are not supported — Profile Extension Manager manages the local desktop install it runs in.
- Not in v1: extension sets/baselines and sync, cleanup of stale profile folders, and pruning of duplicate/outdated extension versions.

## Screenshot

*(GIF placeholder — record `docs/media/matrix.gif` before publishing: open the matrix → toggle a cell → run cleanup.)*

## Publishing checklist (maintainer)

- [x] Verify the Marketplace publisher ID (`SamErde`) is registered and you're signed in to it.
- [x] GitHub repo created: the `repository` field in `package.json` points at `https://github.com/SamErde/ProfileExtensionManager`.
- [ ] Record `docs/media/matrix.gif` (open matrix → toggle a cell → run cleanup) and link it from the Screenshot section above.
- [ ] `npx vsce publish`
