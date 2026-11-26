# ADR-0003: Workspace enablement: read via the public API, change via a guided hand-off

**Status:** Accepted

## Decision

Personas reads whether an extension is enabled in the current workspace only from the public
`vscode.extensions.all` API, and reports **Enabled** / **Not enabled** without a reason. To
change it, Personas hands off to VS Code's Extensions view, where the user runs VS Code's own
"Enable (Workspace)" / "Disable (Workspace)" actions.

## Reason

No official CLI changes workspace enablement: `code --disable-extension` is "not persisted and
is effective only when the command opens a new window" (`code --help`, VS Code 1.143.0,
recorded in `docs/spikes/workspace-extension-status.md`). No public API exposes or changes the
per-workspace disabled list, and Personas does not read VS Code's internal state. Under
ADR-0001, a change no official CLI supports ships as a guided hand-off.

## Consequences

- Personas never claims "Disabled (Workspace)" or any other disable reason.
- The hand-off is offered for Enabled (including Workspace-local) and Not enabled, never for
  Not installed in profile or Unknown.
- After the user changes enablement, VS Code prompts to restart or reload; the column then
  reflects the change (manual scenarios 6-7 in `docs/local-build-test-and-release.md`).

## Boundaries

Workspace status stays within these limits, carried over from the implementation plan:

- Personas does not read `state.vscdb`, add SQLite, or depend on proposed or private VS Code APIs.
  Where the stable API can't support a claim, the status stays `Unknown`.
- The workspace is not a synthetic profile. Workspace data lives in its own inventory and never
  changes a profile's installed list or orphan detection.
- `Extension.isActive` is not an enablement signal: activation is lazy.
- `.vscode/extensions.json` recommendations are never treated as candidates or installations.
- A workspace-only row has read-only profile cells and never calls the `code` CLI, because a
  workspace-local extension may not be published, or may differ from a published extension with
  the same ID.
- The desktop-local, no-remote boundary is kept.
