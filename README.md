# Personas

> [!NOTE]
> This extension was renamed from "Profile Extension Manager" to **Personas** — the former name was too similar to existing Marketplace extensions.

<img src="assets/brand/banner.png" alt="Personas banner" width="100%" />

Easily see and manage which extensions are installed in each VS Code profile, all from one convenient matrix.

## Features

- **Profile x extension matrix**: Show every profile as a column and every extension as a row. Toggle any cell to install or uninstall the extension for that profile.
- **Cross-profile install/uninstall**: Act on any profile directly from the matrix; you never have to switch into a profile just to add or remove an extension from it.
- **Orphan cleanup**: Find extension versions on disk that no profile references, review them (size, last modified), and move them to the Trash/Recycle Bin.
- **Privacy**: This extension never collects or transmits any data.

## Requirements & Limitations

- VS Code Stable or Insiders on Windows, macOS, or Linux.
- Portable installations and custom `--user-data-dir`/`--extensions-dir` are supported.
- Remote workspaces (SSH, WSL, containers, github.dev) are not managed. Personas manages the local desktop install it runs in.

## How It Works

Personas reads the same files VS Code itself maintains: the profile registry and each profile's extension list. All installs and uninstalls run through the official `code` command-line interface, scoped to the right profile (and, when applicable, the right `--user-data-dir`/`--extensions-dir`).

## Releasing (maintainers)

Releases are automated with [release-please](https://github.com/googleapis/release-please) and driven by conventional commits: commits merged to `main` accumulate into a bot-managed release PR that maintains `CHANGELOG.md` and the version bump; merging that PR tags the release and publishes a GitHub Release with the packaged `.vsix` attached. No manual version edits or manual `vsce publish` are part of the normal flow.

- Local packaging: `npm run package` builds a `.vsix` into `releases/` (gitignored, not committed).
- Marketplace publishing runs automatically on each release via the `VSCE_PAT` repository secret (rotate before expiry — a failed publish step is the symptom). Manual fallback: `npx vsce publish --packagePath <released .vsix>`.
