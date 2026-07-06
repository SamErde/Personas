# Changelog

All notable changes to the Personas extension are documented in this file.

## [0.8.6](https://github.com/SamErde/Personas/compare/v0.8.5...v0.8.6) (2026-07-06)


### Bug Fixes

* replace rectangle with circle in activity icon SVG ([f3ff194](https://github.com/SamErde/Personas/commit/f3ff194a620dcc1461fc8a78ca7f73c24cbbf26d))


### Miscellaneous Chores

* realign release-please to published 0.8.5 and trigger 0.8.6 ([e2a04fc](https://github.com/SamErde/Personas/commit/e2a04fc906dc10fea4cd9d9ee116271e1f8abee2))

## [0.8.5](https://github.com/SamErde/Personas/compare/v0.8.3...v0.8.5) (2026-07-06)


### Miscellaneous Chores

* rebrand extension from "Profile Extension Manager" to "Personas"; command, view, and configuration identifiers moved to the `personas.*` namespace ([e493519](https://github.com/SamErde/Personas/commit/e4935195bb70577bfb1d5b004506906251c9774b))

## [0.8.3](https://github.com/SamErde/Personas/compare/v0.8.2...v0.8.3) (2026-07-04)


### Miscellaneous Chores

* first Marketplace release ([8a48630](https://github.com/SamErde/Personas/commit/8a4863008bca44d6fa4a237646f4cf4b4f340562))

## [0.8.2](https://github.com/SamErde/Personas/compare/v0.8.1...v0.8.2) (2026-07-04)


### Bug Fixes

* refresh on silent no-op paths so local pending state always clears ([290fb58](https://github.com/SamErde/Personas/commit/290fb58d1b00c34d2a9320fa2b22180addc7ceed))
* **webview:** instant pending feedback and visible hover-card border ([b8569c5](https://github.com/SamErde/Personas/commit/b8569c52a9d3e492b2d4956468faa45555ab6059))

## [0.8.1](https://github.com/SamErde/Personas/compare/v0.8.0...v0.8.1) (2026-07-04)


### Bug Fixes

* verify message origin in welcome-view handler (code scanning alert 2) ([56e117a](https://github.com/SamErde/Personas/commit/56e117a603c8cda34c6f851c14a6b12e2b7683cd))

## [0.8.0](https://github.com/SamErde/Personas/compare/v0.7.1...v0.8.0) (2026-07-04)

Re-release of the 0.7.1 content with no code changes. A release-automation
fault (draft releases being invisible to release-please's boundary
detection) re-collected the full project history into this version's notes;
the generated entries duplicated earlier releases and were removed. See
the 0.7.0 and 0.6.0 sections below for the actual feature history.

## [0.7.1](https://github.com/SamErde/Personas/compare/v0.7.0...v0.7.1) (2026-07-04)


### Bug Fixes

* attach vsix to draft release before publishing (immutable releases) ([db1fb79](https://github.com/SamErde/Personas/commit/db1fb79b7f72edc57f21bfda04bee8e7a12f69aa))

## [0.7.0](https://github.com/SamErde/Personas/compare/v0.6.0...v0.7.0) (2026-07-04)


### Features

* core types and path resolution from runtime context ([c0fdd75](https://github.com/SamErde/Personas/commit/c0fdd75b9404aa88a21a15bb7e08fd40133b9796))
* defensive parsers for profile registry and extension manifests ([afe9170](https://github.com/SamErde/Personas/commit/afe9170226260c9df20b554586fd29dcbf6d6d8f))
* extension detail hover card and roomier sidebar profile rows ([2930173](https://github.com/SamErde/Personas/commit/29301735fdce4ccbbb1db0d82293cfbfa9a832e3))
* extension icons in matrix, themed welcome button, clearer labels ([85de57f](https://github.com/SamErde/Personas/commit/85de57f9bc5d2f438e84e4489f2fe9bebe5529ab))
* inventory composition and IO service ([a586935](https://github.com/SamErde/Personas/commit/a5869358826e321141ff0465f88cbc8aaa1e1bd9))
* live-refresh read-only profile documents ([05bcf07](https://github.com/SamErde/Personas/commit/05bcf07ee7ed09dd9479d7b165f357374987e11b))
* matrix panel host, service wiring, file watchers, guarded mutations ([b710e52](https://github.com/SamErde/Personas/commit/b710e52d2bf67aa05f3bc5dfca3f56ce0265cac5))
* matrix webview UI with filters, chips, and cleanup flow ([4d0770d](https://github.com/SamErde/Personas/commit/4d0770d5f50cc394627f4b5c1db87c56b25e0873))
* open the matrix automatically from the activity bar (configurable) ([12894de](https://github.com/SamErde/Personas/commit/12894dea898e2e372e942db89548563a37e173d4))
* orphan computation and trash-based cleanup service ([0609589](https://github.com/SamErde/Personas/commit/060958918fef37c5cd611d3b6736c196c750421f))
* per-row bulk install/remove across profiles and apply-to-all guide action ([b22e19f](https://github.com/SamErde/Personas/commit/b22e19f724e4236b509abdc4d1da1cf12854eeb1))
* profiles dashboard in the activity sidebar ([524c734](https://github.com/SamErde/Personas/commit/524c73426bfc1f5280164851bd8a5f2f575ea34d))
* rename to Profile Extension Manager, brand assets, CI, publishable README ([ad7e56b](https://github.com/SamErde/Personas/commit/ad7e56b4bca1cc8e120312bb9d472d1cc61bf0c0))
* serialized CLI mutation service with windows cmd-shim handling ([8d7c418](https://github.com/SamErde/Personas/commit/8d7c418b7b02fc81744ca04948a2b14216443fb7))


### Bug Fixes

* degrade safely on default-manifest and .obsolete parse failures ([5432926](https://github.com/SamErde/Personas/commit/54329260462ac1926c3cc2e2039391a27030d5d6))
* exclude app-scoped extensions from bulk actions; listener/style cleanup ([413729a](https://github.com/SamErde/Personas/commit/413729a3e0f638737c3cddf43d73adc77da2018b))
* icon path guard, stale page title, unsupported-state cleanup ([bbffe86](https://github.com/SamErde/Personas/commit/bbffe860d5fae4b5dfda6def4577378de006fd9f))
* improve README clarity and privacy statement ([119a1b1](https://github.com/SamErde/Personas/commit/119a1b1f77d297f88272e28ee170a26f6edd1eb9))
* keep hover card through keyboard-path refreshes, restore card focus ([28d3f78](https://github.com/SamErde/Personas/commit/28d3f78e3783b3d95335a295cf9e1a2205514dea))
* last-profile confirm with inherited profiles, cancel resync, watcher and stat resilience ([ba4d6c8](https://github.com/SamErde/Personas/commit/ba4d6c88fc603612c53938c91e5c0a8a299e07c2))
* persistent webview toolbar preserving filter focus, live orphan refresh, manual refresh ([7e703c0](https://github.com/SamErde/Personas/commit/7e703c017622ca3416c65b599ae0d201eaf01208))
* prepublish build, unreadable-vs-missing state files, dev-host guard, unsupported panel state ([2ffa6e5](https://github.com/SamErde/Personas/commit/2ffa6e5fc58fe1ea6f2fc9595df87129e350dde1))
* register file watchers with service construction, not matrix open ([47a0723](https://github.com/SamErde/Personas/commit/47a0723564f154b6a6490a2259d1489feda4ba2d))
* reject profile names with double quotes; document deleteFolders contract ([58093aa](https://github.com/SamErde/Personas/commit/58093aafddd36f67755f3c04ea85caed80248beb))
* suppress orphan reporting when profile registry is unreadable ([5c8f54d](https://github.com/SamErde/Personas/commit/5c8f54d607c687f64111c746ca8fe93eb7c18fae))
* validate extension-page opens, honest marketplace disclosure, card survives refresh ([8a42a4b](https://github.com/SamErde/Personas/commit/8a42a4bb6464c13b4707e71e308ea47165d224c8))

## 0.6.0 (2026-07-04)

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
- Sidebar profile rows now wrap onto two lines — name (with a tooltip for long names) on the first, the "N direct + M shared" counts in dimmer text on the second — so long profile names no longer crowd the counts.
- Extension detail hover card in the matrix: hovering (or focusing) an extension's name shows its icon, publisher, description, version, and local install date, plus the row's bulk actions (install/remove/apply to all profiles), replacing the version text and always-hidden per-row action buttons. All data shown in the card is read from the offline extension manifests/package.json; the card's clickable name opens the extension's page via VS Code (which may contact the Marketplace per VS Code's own settings).
