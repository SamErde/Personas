---
name: profile-extension-manager-project
description: "State of the Personas VS Code extension project (formerly \"Profile Extension Manager\", earlier working name \"Visex\")"
metadata: 
  node_type: memory
  type: project
---

**Personas** (renamed 2026-07-06 from "Profile Extension Manager"; earliest working name was "Visex"). Package name is `personas`, GitHub repo renamed to `SamErde/Personas` (done 2026-07-06; `origin` remote updated), displayName/category/activity-bar label "Personas". VS Code extension showing an extensions × profiles matrix with cross-profile install/uninstall via the `code` CLI and orphan cleanup (trash + confirm).

The rename touched every layer: command/view/config IDs are now `personas.*` (was `profileExtensionManager.*` — breaking for existing keybindings/settings, accepted pre-1.0); URI scheme `personas-readonly` (was `pem-readonly`); dev-host escape hatch env var is now `PERSONAS_DEV_ALLOW=1` (was `PEM_DEV_ALLOW`); integration-test env vars `PERSONAS_IT_*` (was `VISEX_IT_*`); test fixture is `personas-tests.personas-hello-fixture`. Class/fn `PersonasReadOnlyContentProvider`/`registerPersonasReadOnlyProvider`. After rename: lint clean, 82 unit tests pass, build OK. (At v1.0.1: 151 unit tests passing, 1 skipped, plus 2 integration tests.)

**Why:** future sessions must not use the old names — many identifiers changed across every layer.

**Release state:** 1.0.1 (released 2026-10-11) is the current published release; 1.0.0 (2026-08-11) was the first stable release. As of 2026-07-06, 0.8.6 was the current published release, cut cleanly via release-please (see [[personas-release-workflow]]). The Marketplace publish step now SUCCEEDS — the "Personas" name is accepted (the old "Profile Extension Manager" name was rejected as too similar to "Private Extension Manager"). PR #23 removed the temporary `continue-on-error` AND moved the Marketplace publish into its own `publish-marketplace` job (so a publish failure is visible but doesn't skip the phase-3 `release-pr` job — a regression Codex correctly flagged). GitHub Releases exist for v0.8.6 and v0.8.0–v0.8.3; v0.8.4 (untagged test) and v0.8.5 (published via manual `vsce publish patch`) have no GitHub Release — a harmless historical gap.

**Deferred follow-up (user-requested 2026-07-06):** do a holistic review of the GitHub Actions workflows (`.github/workflows/ci.yml` + `release-please.yml`) as a whole. Workflow hardening has since landed in PR #50 and PR #55.

**How to apply:** brand source of truth is `assets/BRAND.md` (v3: three-heads mark, amber active persona, tagline "Easily manage your dev personas: the different Git identities, VS Code profiles, and extensions that you need in different contexts."). Deliberately NOT renamed: historical CHANGELOG version entries + commit/compare URLs (real history; GitHub redirects the repo rename), and dated `docs/superpowers/` filenames (content updated, filenames kept). Brand SVG artwork already matches the new mark — only wordmark text was swapped; PNGs (banner.png etc.) still need regeneration from the SVGs. Verified VS Code state-file facts in `docs/spikes/findings.md`; apply-to-all-profiles is NOT programmatically togglable (guided fallback shipped). If `ELECTRON_RUN_AS_NODE=1` is set globally in the environment, the integration harness strips it before launching @vscode/test-electron (otherwise Code launches as bare Node). Remaining optional cleanup: regenerate PNG brand assets (banner.png etc.) from the updated SVGs; delete the stale `deps-migration` branch. (The `continue-on-error` cleanup is done — PR #23.)
