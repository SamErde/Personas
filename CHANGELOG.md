# Changelog

All notable changes to the Profile Extension Manager extension are documented in this file.

## [Unreleased]

### Added

- Extension × profile matrix view.
- Cross-profile install/uninstall via the VS Code CLI.
- `ALL` badge distinguishing extensions applied to all profiles via VS Code's native flag from those merely installed in every profile.
- Orphaned-extension cleanup (review + confirm, moves to Recycle Bin/Trash).
- No telemetry — this extension does not collect or transmit any data.
- Clicking the activity-bar icon now opens the Extension Matrix automatically; configurable via `profileExtensionManager.openMatrixOnActivityBarClick`.
- Per-row bulk actions in the extension matrix: install in every profile via the CLI, remove from every profile where it's directly installed, and a guided "Apply to all profiles…" shortcut that opens the Extensions view for VS Code's native toggle.
- UX polish: extension icons in the matrix (with a themed letter-tile fallback), a correctly-themed "Open Extension Matrix" button in dark themes, a clearer "Applied to all profiles" filter label, and a "Profile Extension Matrix" tab title.
- Profiles dashboard in the activity sidebar: per-profile extension counts ("N direct + M shared"), an orphaned-extensions summary with reclaimable size and a shortcut into the cleanup view, and parse-warning notices. Profile files open as live-updating read-only documents (with an explicit edit affordance for the raw file).
