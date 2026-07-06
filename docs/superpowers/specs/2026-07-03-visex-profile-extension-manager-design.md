# Personas: Design Spec

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan
**Naming note:** originally drafted under the working name "Visex"; the extension was subsequently renamed to **Personas** (identifier `personas`).

## Purpose

A Visual Studio Code extension that makes VS Code profiles' extension state visible and manageable from one place. VS Code stores profiles under the user data directory in ways that are hard to inspect by hand; the built-in UI offers no cross-profile overview and requires switching profiles to change what's installed where.

### Core jobs (v1)

1. **Visibility / audit** — a matrix of all extensions × all profiles: what's installed where, what's flagged for all profiles, what's orphaned on disk.
2. **Install / remove across profiles** — toggle any extension in any profile without switching profiles.
3. **Cleanup** — find extensions on disk that no profile references, and remove them after explicit review and confirmation.

### Non-goals (v1)

- Extension **sets / baselines / sync** between profiles (deferred to v2; a "Differences" view is deferred with it, since differences are only meaningful against a baseline — differing extensions are otherwise the whole point of profiles).
- Managing a **different** VS Code installation than the one Personas runs in.
- Remote workspaces (SSH/WSL/Containers/web). Personas declares `"extensionKind": ["ui"]` and always runs locally.
- Cleanup of stale profile folders or outdated duplicate extension versions (v2 candidates).
- Telemetry. None, ever — stated in the README as a feature.

### Supported environments

- VS Code **Stable** and **Insiders**, including **portable mode** and custom `--user-data-dir`, on **Windows, macOS, and Linux**.
- Variant support falls out of the architecture: all paths are derived at runtime from the running instance, never hardcoded per variant.

## Architecture

**Approach: hybrid — read from disk, mutate via CLI.** The VS Code extension API is profile-scoped (`vscode.extensions.all` only sees the current profile), so Personas reads VS Code's own state files for the full picture and uses the supported `code` CLI for mutations. Direct writes to VS Code's state files are avoided (corruption/race risk), except deleting orphaned extension folders that nothing references.

### Components

All extension-host code is TypeScript. Five units, each independently testable:

**1. `PathResolver`** — derives every filesystem location from the running instance:
- User data dir: walk up from `context.globalStorageUri` (`…/User/globalStorage/<ext-id>` → `User/`).
- `code` CLI binary: derived from `vscode.env.appRoot` per platform.
- Global extensions dir (`~/.vscode/extensions` or variant equivalent).
- The only unit containing OS/variant-specific logic. Pure path functions; unit-tested without VS Code.

**2. `InventoryService`** — the read side. Parses three sources into one `Inventory` snapshot:
- Profile registry: `User/globalStorage/storage.json` → `userDataProfiles` (plus the implicit default profile).
- Per-profile installed extensions: each profile's `extensions.json`.
- Global extensions folder: versions on disk, folder sizes, apply-to-all-profiles metadata.

Exposes `getInventory(): Inventory` and a change event driven by file watchers on those sources, so the matrix refreshes when extensions change through normal VS Code UI. Parsing is defensive: unknown fields ignored; a malformed file yields a warning banner and partial inventory, never a crash.

**3. `MutationService`** — the write side. Wraps the CLI:
- `install(extensionId, profileName)` / `uninstall(extensionId, profileName)` via spawned `code --profile <name> --install-extension <id>` (resp. `--uninstall-extension`).
- Calls serialized through a queue (one CLI process at a time); stderr captured for error reporting.
- Apply-to-all-profiles toggle: invoke VS Code's built-in toggle command. If the command proves non-invocable with an extension argument (see Risks), fall back to guiding the user to the Extensions view; do not write the metadata file directly in v1.

**4. `CleanupService`** — computes orphans (extension folders referenced by zero profiles and not flagged apply-to-all-profiles), with disk usage and last-modified dates. Deletes only through the review-and-confirm flow, and moves folders to the Recycle Bin/Trash rather than deleting permanently.

**5. `MatrixPanel`** — webview provider for the matrix UI. Vanilla TypeScript + CSS using VS Code theme variables (no framework). The webview owns zero business logic: it renders serialized `Inventory` JSON and posts user intents (toggle cell, filter, cleanup) back to the host.

### Data model

```ts
interface Inventory {
  profiles: Profile[];            // { id, name, isDefault, location }
  extensions: ExtensionRecord[];  // one per extension identity
}

interface ExtensionRecord {
  id: string;                     // publisher.name
  displayName: string;
  versions: DiskVersion[];        // folders on disk: { version, path, sizeBytes }
  applyToAllProfiles: boolean;    // the native VS Code flag
  installedIn: string[];          // profile ids referencing this extension
  // derived: orphaned = installedIn.length === 0 && !applyToAllProfiles
}
```

The webview receives exactly this shape, so the display and the services cannot drift apart.

## UX flows

**Opening:** Command palette ("Personas: Show Extension Matrix") or activity-bar icon. The matrix opens as a full editor tab (it is too wide for the sidebar).

**Matrix:** rows = extensions (name + version), columns = profiles, cells = toggles.
- Cell states: installed (✓), not installed (empty). Apply-to-all-profiles renders as a row-level badge (the flag is per-extension, not per-cell).
- Above the grid: text filter and view chips — **All / Orphaned / All-profiles**.
- An orphan count with total reclaimable disk space links to the cleanup flow.

**Toggling a cell:** click → spinner → CLI runs → the file watcher observes the change and re-renders from actual disk state. No optimistic UI: disk is the source of truth, so the matrix cannot show a state that does not exist. On failure: cell reverts, toast shows CLI stderr with a "copy details" action.
- Uninstalling an extension from its **last** profile prompts one confirmation. All other toggles are single-click (easily reversible).

**Cleanup:** "Review orphaned extensions" opens a checklist — each orphan with version(s), size, last-modified date, all **pre-unchecked**. The user checks items, clicks "Move to Recycle Bin/Trash", and confirms once in a native modal listing exactly what will be removed. Results are reported per item. No cleanup action ever runs without this explicit review and confirmation.

## Error handling

Three failure classes, each with defined behavior:

1. **Can't find things** (no CLI binary, no `storage.json`, unsupported environment): the panel renders a clear "Personas can't manage profiles in this environment" state explaining why. Never a blank screen or a stack trace.
2. **Can't parse things** (format drift in a future VS Code release): warning banner naming the file; the matrix renders whatever parsed; mutations for affected profiles are disabled rather than guessed at.
3. **Mutation failed** (CLI nonzero exit): error surfaced verbatim, state re-read from disk, no automatic retry.

## Testing & CI

- **Unit tests** (bulk of coverage): `PathResolver` and all parsers run against fixture copies of real `storage.json` / `extensions.json` files captured from Windows, macOS, and Linux. No VS Code required.
- **Integration tests:** `@vscode/test-electron` launches real VS Code with a temp `--user-data-dir`, creates profiles via the CLI, and exercises `InventoryService` + `MutationService` end to end. Doubles as the early-warning system for state-file format drift.
- **CI:** GitHub Actions matrix on `windows-latest`, `macos-latest`, `ubuntu-latest`: both suites, lint, and a `vsce package` smoke check on every PR.

## Risks & verification spikes (do first)

1. **Apply-to-all-profiles toggle:** verify whether the built-in toggle command can be invoked programmatically with an extension argument, and the exact semantics of the flag in `extensions.json` metadata. If not invocable, v1 ships the read-only badge plus a guided fallback.
2. **`extensions.json` semantics:** confirm the exact relationship between the global extensions folder manifest and per-profile `extensions.json` files on all three OSes before building the parsers.
3. **CLI behavior in portable mode:** confirm the derived CLI path and that `--profile` operations respect the portable data dir.

## Effort estimate

Assumptions: solo developer with AI assistance; marketplace-quality bar; risks above resolve without major surprises.

**Estimate: 3–6 working days** to a publishable v1.

- Scaffolding + `PathResolver` + `InventoryService`: ~1 day
- Matrix webview: ~1–2 days
- `MutationService` + confirmations: ~1 day
- Cleanup flow, cross-platform testing, CI, docs, packaging: ~1–2 days

The range's upper end covers the risk items (all-profiles toggle, format quirks per OS) landing badly.

## Packaging & marketplace

- MIT license; published with `vsce` under the author's publisher ID.
- README with an animated GIF of the matrix; CHANGELOG maintained from v0.1.
- Explicit non-goals documented in the README (sets/sync, remote, other installs).
- No telemetry, stated prominently.
