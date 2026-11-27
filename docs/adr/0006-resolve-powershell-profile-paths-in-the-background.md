# ADR-0006: Resolve PowerShell profile paths in the background

**Status:** Accepted

## Decision

Render passive installation discovery immediately, then asynchronously ask detected PowerShell
executables for `$PSHOME` and `$PROFILE.CurrentUserAllHosts`. Start them with profiles disabled,
bound their runtime, and accept only a narrow validated CLIXML response. Runtime discovery defaults
on; its machine-scoped setting remains an opt-out. On Windows, the existing registry agreement
resolver is the fallback when probes are disabled or fail.

Cache successes and failures for the session. Watcher refreshes reuse both; explicit refresh retries
all failures, while **Run … to resolve** retries one installation. If installations in one edition
report different current-user directories, leave that directory unresolved rather than choose one.

## Reason

PowerShell's own `$PROFILE` value is the canonical answer and preserves Windows known-folder
redirection without adding a native dependency. Publishing passive results first keeps process
startup off the view's critical path. The probe uses only property reads that work in the tested
forced Constrained Language Mode; enforced App Control compatibility still requires separate proof.

## Consequences

PowerShell may start automatically during discovery, but no profile script is loaded. Users who
cannot or do not want that process start can disable runtime discovery and retain the conservative
registry fallback.
