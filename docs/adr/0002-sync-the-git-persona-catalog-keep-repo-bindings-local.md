# ADR-0002: Sync the Git persona catalog; keep repo bindings local

**Status:** Accepted, not yet implemented. Stage 1 of Git personas, the read-only Git
Configuration view, shipped in 1.5.0 without a catalog or bindings. The later stages that
this decision governs are tracked in [#162](https://github.com/SamErde/Personas/issues/162).

## Decision

The catalog of Git personas is stored in `ExtensionContext.globalState` and registered for
Settings Sync with `globalState.setKeysForSync(...)`, so it follows the user to every machine.

Repo bindings (which Git persona a repository uses) are stored locally only and are never
registered for sync.

## Reason

A Git persona (display name, `user.name`, `user.email`) means the same thing on every machine.
A repo binding is keyed by an absolute repository-root path, which is machine-specific and
can reveal private directory structure, so syncing it would be both wrong elsewhere and a
leak.

## Consequences

- On a new machine the user sees their Git personas but must bind repositories again.
- A binding whose persona was deleted (possibly on another machine) is reported as stale,
  never silently remapped.

See `docs/design/2026-07-09-git-identity-personas-design.md`.
