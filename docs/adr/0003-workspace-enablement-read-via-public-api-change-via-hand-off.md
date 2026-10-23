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
