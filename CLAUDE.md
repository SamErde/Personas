# Personas — project guide

VS Code extension that shows and manages a developer's personas from one sidebar, published as
`SamErde.personas`:

- the **Extension Matrix** (extensions × profiles, cross-profile install/uninstall via the
  `code` CLI, orphaned-extension cleanup, a Current workspace column);
- three sidebar views: **VS Code Profiles**, **PowerShell Profiles** (create/open/trash profile
  scripts), and **Git Configuration** (read-only; stage 1 of Git personas).

User-facing docs are `README.md` (also the Marketplace page) and `docs/user-guide.md`; planned
work is in `docs/roadmap.md` and its tracking issues. (The extension was renamed from "Profile
Extension Manager"; earliest working name "Visex". See `docs/history.md`.)

## Workflow — important

- **PRs only.** Never commit directly to `main`; branch + PR.
- **release-please owns versioning.** Never hand-edit `version` in `package.json` /
  `package-lock.json` / `.release-please-manifest.json`, and never run `vsce publish`
  manually. (The one maintainer-only exception, recovering a failed Marketplace job, is in
  `docs/local-build-test-and-release.md`; an agent never runs it.) Merging a release PR
  tags the version and publishes. To force a version, use a `Release-As: x.y.z` commit
  footer.
- Marketplace publish runs as its **own** workflow job, so a publish failure is visible
  without blocking the next release PR (see `.github/workflows/release-please.yml`).

## Conventions

- Command / view / configuration IDs are namespaced **`personas.*`** (renamed from
  `profileExtensionManager.*` — do not reintroduce the old IDs). URI scheme is
  `personas-readonly`; the dev-host escape-hatch env var is `PERSONAS_DEV_ALLOW=1`.
- **Brand source of truth: `assets/BRAND.md`.** The extension is "Personas" — no other
  name/variant; don't invent names or colors.

## Architecture

- Reads VS Code's own profile registry + per-profile extension lists from disk; performs
  installs/uninstalls through the supported `code` CLI. Never writes VS Code state files
  directly. ADR-0001 lists the exceptions: deleting orphaned extension folders, and creating
  and trashing PowerShell profile scripts. Git configuration is only read (`git config
  --list`). `extensionKind: ["ui"]` — local desktop only, no remote workspaces.
- Source map: `src/core/` (inventory, parsers, CLI runner, mutations, cleanup), `src/panel/`
  (view providers and the matrix panel), `src/webview/` (webview scripts and styles),
  `src/powershell/` (discovery and file actions), `src/git/` (config reading).
- Settings live under `personas.*` in `package.json`; PowerShell runtime discovery is off by
  default (ADR-0005).
- "Apply to all profiles" is **not** togglable via public VS Code API; a guided fallback
  ships instead (see `docs/spikes/findings.md`).

## Build & test

- `npm run lint` (tsc --noEmit) · `npm test` (vitest unit) · `npm run build` (esbuild)
- Preview generated output and stale VS Code installs with `npm run clean`.
- Remove eligible directories with `npm run clean -- --force` ([cleanup instructions](docs/local-build-test-and-release.md#cleanup)).
- `npm run test:integration` — runs against a sandboxed VS Code (node:test). It builds first;
  `test:integration:prebuilt` skips the build and reuses `dist/` (CI builds once, via `vsce package`).

## Deeper context (read on demand — not every session)

- `docs/adr/` — architecture decisions (read the ones touching your area).
- `docs/spikes/findings.md` — verified VS Code state-file / CLI / workbench facts.
- `docs/design/` — the v1 design spec and the Git identity personas design.
- `docs/history.md` — development history, renamed identifiers, and permalinks to removed docs.
- `docs/local-build-test-and-release.md` — sandbox testing, manual scenarios, release recovery.

## Agent skills

### Issue tracker

GitHub Issues on `SamErde/Personas` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
