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
  personas design (`docs/superpowers/specs/2026-07-09-git-identity-personas-design.md`).
- Current-workspace extension status shipped (`c063ac7`): a read-only Current workspace
  card and matrix column with Enabled / Not enabled / Not installed in profile /
  Workspace-local / Unknown statuses. **PR #38** fixed the local sandbox testing guide.
- **v1.0.0** released 2026-08-11 (**PR #34**), the first stable release. The disposable
  sandbox UI acceptance for workspace status later passed (recorded in #68).

## 2026-08 → 10 — Hardening and v1.0.1

- CI: workflows hardened (**PR #50**) and job execution time bounded (**PR #55**);
  vitest 4 → 5 (**PR #44**).
- **v1.0.1** released 2026-10-11 (**PR #59**): `@types/vscode` held to the 1.90 engine
  minimum (**PR #58**). Node and dependencies updated (**PR #62**); Marketplace
  publishing moved to vsce v4 (**PR #63**).
- Test counts at v1.0.1: 151 unit tests passing (1 skipped) across 9 files, plus 2
  integration tests.
