# Personas — project guide

VS Code extension: an **extensions × profiles matrix** with cross-profile
install/uninstall (via the `code` CLI) and orphaned-extension cleanup. Published as
`SamErde.personas`. (Repo folder is still `Profile-Extension-Manager`; the extension was
renamed from "Profile Extension Manager" — earliest working name "Visex".)

## Workflow — important

- **PRs only.** Never commit directly to `main`; branch + PR.
- **release-please owns versioning.** Never hand-edit `version` in `package.json` /
  `package-lock.json` / `.release-please-manifest.json`, and never run `vsce publish`
  manually. Merging a release PR tags the version and publishes. To force a version, use a
  `Release-As: x.y.z` commit footer.
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
  directly (except deleting orphaned extension folders). `extensionKind: ["ui"]` — local
  desktop only, no remote workspaces.
- "Apply to all profiles" is **not** togglable via public VS Code API; a guided fallback
  ships instead (see `docs/spikes/findings.md`).

## Build & test

- `npm run lint` (tsc --noEmit) · `npm test` (vitest unit) · `npm run build` (esbuild)
- `npm run test:integration` — runs against a sandboxed VS Code (node:test).

## Deeper context (read on demand — not every session)

- `docs/project-memory/` — development history and release-workflow detail.
- `docs/spikes/findings.md` — verified VS Code state-file / CLI facts.
- `docs/superpowers/` — original design spec and implementation plan.
