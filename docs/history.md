# Personas — Development History

> Curated timeline of the Personas extension (formerly **Profile Extension Manager**;
> earliest working name **Visex**), extracted from the `.remember/` workspace journals
> of the `Private-Workshop` multi-root workspace where the project was originally
> developed. Non-Personas journal entries (unrelated tooling/DSC/tenant work) were
> omitted. Timestamps in the source journals were inconsistent, so entries are grouped
> by phase rather than exact clock time.

## Week of 2026-06-29 — Design & core implementation (as "Visex")

- Designed **Visex**, a multi-profile VS Code extension: requirements interview,
  three approaches analyzed, hybrid approach selected (read profile/extension state
  from disk, mutate via the `code` CLI); ~3–6 day estimate.
- Committed the design spec: 5-component architecture, grid UI (Differences view removed).
- Spec-driven implementation, Tasks 1–12 (57 tests passing). Spike A verified 32 distinct
  extension IDs (11 own + 21 app-scoped, disjoint); Spike C confirmed the partial-dir
  hybrid fallback.
- Core modules landed: inventory safety, registry suppression, mutations with queue
  recovery + stderr fallback, integration + webview.
- Renamed to **Profile Extension Manager**; brand assets added.

## 2026-07-03

- Tasks 1–8: inventory-safety TDD (`.obsolete` degraded, guard widened), registry
  suppression (`5c8f54d`), mutation service with queue recovery (`c454461`); 40/40 tests.
- Tasks 9–12 merged (gate fix, webview, integration); 57 tests passing (`2e8d6c2`).
  Task 13 (rename to Profile Extension Manager, packaging, CI) resuming.

## 2026-07-04 — v0.1.0 → v0.8.1, UX waves, release automation

- **v0.1.0** complete via the 13-task SDD pipeline (architecture → core → UI → 3-OS CI);
  GitHub repo with GHAS/Dependabot/branch protection; mocha → node:test.
- Locked 4 features: activity-bar auto-open, bulk row actions, guided all-profiles
  handoff, upstream VS Code request. Implemented bulk row actions + app-scope safety
  (66/66 tests, `413729a`).
- UX waves: **Wave 2** (auto-open matrix, bulk actions); **Wave 3** (`bbffe86` — themed
  button, extension icons + fallback/path guard, sidebar with live counts/orphans/badges,
  live profile viewer; 77 unit + 2 integration); **Wave 4** (`28d3f78` — sidebar/card
  layout, gallery disclosure, extId validation, refresh resilience, keyboard focus
  recovery; 82 unit + 2 integration).
- Dependency modernization: TS 6, vitest 4, mocha → node:test, @types/node 22
  (443 → ~389 pkgs). Cut v0.5.0, then v0.6.0 (release-please CI; a packaging job failed
  initially).
- Fixed the release-please 3-phase workflow (draft → gates → publish), ending a
  release-PR loop; rejected PR #15 (webview origin-check bug); merged **v0.8.1** (PR #16).
- **Wave 6** pending-state fix (`290fb58`). Marketplace publishing configured
  (Azure DevOps PAT → repo secret; publish workflow enabled).
- **v0.8.3** shipped to GitHub with automated Marketplace publish — initially blocked on
  a display-name exception ("Profile Extension Manager" too similar to "Private Extension
  Manager").

## 2026-07-06 — Rebrand to Personas

- Rebranded **Profile Extension Manager → Personas** across 30+ files (package.json IDs,
  src, tests, docs, CI, SVGs); CHANGELOG updated; GitHub repo renamed and `origin` remote
  synced. 82 tests passing, build OK.

## 2026-07-06 / 07 — Release recovery & v0.8.6

- Added the view `icon` property (package.json). Reconciled a version drift across
  package.json / package-lock.json / .release-please-manifest.json / CHANGELOG → 0.8.4.
- An accidental `vsce publish patch` published **0.8.5** out-of-band. Recovered via
  release-please: **PR #21** (manifest 0.8.4 → 0.8.5, CHANGELOG consolidated,
  `Release-As: 0.8.6` footer) and **PR #22** (the 0.8.6 release).
- Published **v0.8.6** to the Marketplace (a new activity-bar icon as the headline
  change); GitHub release history backfilled.
- **PR #23**: decoupled the Marketplace publish into its own workflow job so a publish
  failure is visible without skipping the next release PR.

## 2026-07 / 08 — Git identity design and v1.0.0

- **PR #24** imported this project memory and history; **PR #25** added the Git identity
  personas design (`docs/design/2026-07-09-git-identity-personas-design.md`).
- Current-workspace extension status shipped (`c063ac7`): a read-only Current workspace
  card and matrix column with Enabled / Not enabled / Not installed in profile /
  Workspace-local / Unknown statuses. **PR #38** fixed the local sandbox testing guide.
- **v1.0.0** released 2026-08-11 (**PR #34**), the first stable release. The disposable
  sandbox UI acceptance for workspace status ran on 2026-10-20: scenarios 1–11 passed and
  12–14 are not yet run ([results on #68](https://github.com/SamErde/Personas/issues/68#issuecomment-6305363767)).

## 2026-08 → 10 — Hardening and v1.0.1

- CI: workflows hardened (**PR #50**) and job execution time bounded (**PR #55**);
  vitest 4 → 5 (**PR #44**).
- **v1.0.1** released 2026-10-11 (**PR #59**): `@types/vscode` held to the 1.90 engine
  minimum (**PR #58**). Node and dependencies updated (**PR #62**); Marketplace
  publishing moved to vsce v4 (**PR #63**).
- Test counts at v1.0.1: 151 unit tests passing (1 skipped) across 9 files, plus 2
  integration tests.

## 2026-10 — Cleanup, packaging, and v1.1.0 → v1.2.0

- **v1.1.0** released 2026-10-21 (**PR #82**): the minimum VS Code version rose to 1.101, and
  workspace-local manifests were fixed on Node 22 extension hosts.
- A seven-step cleanup before the Git identity personas work (issues #68–#74), shipped in
  1.1.1 through 1.1.3:
  - **PR #80:** stale docs fixed; `GLOSSARY.md` and the first ADRs added.
  - **PR #84:** one CLI runner for `code` and `git`, with a timeout and an injected platform.
  - **PR #86:** one path module.
  - **PR #87:** the matrix mutation rules moved into a tested `MatrixActions` service.
  - **PR #88:** swallowed IO errors surfaced, dead code removed, duplicated helpers merged.
  - **PR #90:** naming aligned with the glossary.
  - **PR #91:** webview messages split from the domain types, and the sidebar restructured as
    **Home**.
- CI and packaging:
  - **PR #92:** each CI job builds once instead of three or four times.
  - **PR #93 (v1.1.3):** sourcemaps left out of the VSIX, which dropped it from 121 KB to 55 KB;
    the Marketplace publish uses the locked vsce.
  - **PR #96:** spike probes moved out of `test/` and `scripts/`.
  - **PR #97:** the publish job skips dependency install scripts.
- **v1.2.0** released 2026-10-23 (**PR #101**). Features came from user feedback in discussion
  #48:
  - **PR #100:** a row and column crosshair highlight in the Extension Matrix.
  - **PR #104:** a high-contrast outline for the highlighted labels.
  - **PR #106:** a pinned extension-name column.
  - **PR #103:** a guided hand-off from the Current workspace column to VS Code's own
    "Enable (Workspace)" / "Disable (Workspace)" actions (ADR-0003).
- Test counts at v1.2.0: 215 unit tests passing (2 skipped) across 12 files, plus 2 integration
  tests.

## 2026-11 — PowerShell profiles, matrix filters, and the three-view sidebar (v1.3.0 → v1.5.0)

From here on, [CHANGELOG.md](../CHANGELOG.md) is the authoritative record. These are the
highlights:

- **v1.3.0** (2026-11-15):
  - PowerShell profile management in Home (**PR #116**);
  - the Agents window profile shown for what it is (**PR #110**);
  - outlined buttons in high-contrast themes (**PR #118**).
- **v1.4.0** (2026-11-21):
  - accessible matrix cells with distinct states (**PR #131**);
  - focus kept through rebuilds (**PR #134**);
  - extension categories and install sources (**PR #130**), with a filter model, publisher
    search, and session view state (**PR #135**);
  - category, publisher, and source filters (**PR #137**) and group-by (**PR #138**);
  - one toolbar style with a Legend (**PR #147**);
  - a shared profile order (**PR #132**).
- **v1.5.0** (2026-11-26):
  - each Home section loads once per show (**PR #153**);
  - Home split into separate VS Code Profiles and PowerShell Profiles views (**PR #155**);
  - a read-only Git Configuration view, stage 1 of Git personas (**PR #156**);
  - Home settings, with PowerShell runtime discovery off by default;
  - default view sizes, a settings gear, and PowerShell help in a dialog (**PR #161**).
- **Documentation refresh** (2026-11-26):
  - a new README and user guide;
  - planned work moved into tracking issues #162–#168;
  - the stale documents listed below removed.

## Renamed identifiers

The extension was renamed twice, Visex → Profile Extension Manager → Personas (2026-07-06).
Don't reintroduce these old identifiers:

| Old | Current |
| --- | --- |
| `profileExtensionManager.*` command, view, and setting IDs | `personas.*` |
| `pem-readonly` URI scheme | `personas-readonly` |
| `PEM_DEV_ALLOW` | `PERSONAS_DEV_ALLOW` |
| `VISEX_IT_*` integration-test variables | `PERSONAS_IT_*` |

Historical CHANGELOG entries and commit links keep the old names on purpose.

## Removed documents

These documents were removed in the documentation refresh. Their lasting content moved to the
places shown, and the originals remain available at the last commit that contained them.

| Document | Where its content went |
| --- | --- |
| [v1 implementation plan](https://github.com/SamErde/Personas/blob/7cfc5ac/docs/superpowers/plans/2026-07-03-visex-v1.md) | Facts in `docs/spikes/findings.md`; remaining deferred items in #164; the not-planned sets, baselines, sync, and Differences view decision in #165 |
| [Current workspace status plan](https://github.com/SamErde/Personas/blob/7cfc5ac/docs/plans/2026-08-10-current-workspace-extension-status.md) and its [agent prompt](https://github.com/SamErde/Personas/blob/7cfc5ac/docs/plans/2026-08-10-current-workspace-extension-status-prompt.md) | Boundaries in ADR-0003; open scenarios in #167 |
| [Extension Matrix filters plan](https://github.com/SamErde/Personas/blob/7cfc5ac/docs/plans/2026-11-15-extension-matrix-filters.md) | ADR-0004; install-source fact in `findings.md` |
| [Home layout polish plan](https://github.com/SamErde/Personas/blob/7cfc5ac/docs/plans/2026-11-26-home-layout-polish.md) | `findings.md` (Home view layout, Opening Settings) |
| [Project memory index](https://github.com/SamErde/Personas/blob/7cfc5ac/docs/project-memory/MEMORY.md), [project state](https://github.com/SamErde/Personas/blob/7cfc5ac/docs/project-memory/profile-extension-manager-project.md), and [release workflow](https://github.com/SamErde/Personas/blob/7cfc5ac/docs/project-memory/personas-release-workflow.md) | Renamed identifiers above; release realignment in `docs/local-build-test-and-release.md` |
| [Upstream apply-to-all-profiles draft](https://github.com/SamErde/Personas/blob/7cfc5ac/docs/upstream/vscode-toggle-apply-all-profiles.md) | #166 |

The design specs moved from `docs/superpowers/specs/` to [`docs/design/`](design/).

