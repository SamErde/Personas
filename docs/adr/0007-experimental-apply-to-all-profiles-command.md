# ADR-0007: Offer apply-to-all-profiles through a guarded experimental command

**Status:** Accepted

## Context

VS Code exposes **Apply Extension to all Profiles** in its own UI, but not through a public API
or CLI. The internal `workbench.extensions.action.toggleApplyToAllProfiles` command works when it
receives both the extension ID and `{ location: extension.extensionUri }`; that private contract
can change without notice. Personas currently offers only a guided hand-off to the Extensions
view under ADR-0001.

## Decision

Personas will make one narrow experimental exception to ADR-0001: for an ordinary locally
installed extension, it may invoke the internal command to change the extension from
profile-scoped to **applied to all profiles**.

The action is available by default behind the application-scoped
`personas.experimentalFeatures.enabled` setting. This task's default-on decision supersedes the
issue's earlier opt-in wording; the setting cannot be enabled by a workspace. Turning it off
removes experimental actions without removing the native Extensions-view hand-off. The action
itself remains explicitly labeled **Experimental** and asks for confirmation that names the
unsupported compatibility risk.

The operation is fail-closed and one-way in this first slice:

1. Re-read the inventory. Treat application scope as unknown, and stop, when the profile registry
   or any extension manifest is unreadable; a Boolean `false` from partial data is not actionable.
2. Return without invoking the toggle when the extension is already applied to all profiles.
3. Confirm that the internal command is registered and the running VS Code version is within the
   source-inspected/tested 1.101-1.148 range.
4. Resolve the extension with `vscode.extensions.getExtension`, require a `file:` URI, and compare
   canonical real paths to accept only an extension inside `services.paths.extensionsDir` (the
   running VS Code instance's user extension pool, not its built-in extension directory). Reject
   extension packs and dependency relationships: the target must neither declare
   `extensionPack`/`extensionDependencies` nor be named by another installed extension's lists.
   An unreadable pool listing or package manifest makes relationship eligibility unknown and stops
   the experimental path.
5. Ask for confirmation, explaining that the command is experimental and unsupported.
6. Immediately before execution, re-check the setting, authoritative state, command registration,
   and resolved local target. A preflight failure returns to the native guided hand-off.
7. Invoke the command with the extension ID and `{ location: extension.extensionUri }`.
8. Re-read the inventory and report success only when application scope is known and
   `applyToAllProfiles` is `true`. A verification mismatch is an error and is never retried.

Personas never writes VS Code's `extensions.json` files. This ADR does not add an experimental
remove-from-all-profiles action. The supported upstream API request remains part of issue #166,
but this task explicitly defers searching for or submitting it; the implementation PR must not
claim to close that remaining deliverable.

## Consequences

- A private VS Code command can regress between releases, but a missing command, unresolved or
  non-local extension, unknown state, out-of-range VS Code version, and verification mismatch all
  stop without a second toggle.
- The inventory exposes whether application-scope state is complete. The Extension Matrix
  advertises the experimental action only after checking the setting, command registration, and
  each row's runtime/path eligibility. It updates when the setting changes. The extension host
  repeats every safety check when the user acts; the webview is never the authority.
- The native guided flow remains available independently, including for every disabled,
  unavailable, or ineligible experimental case.
- Remote, web, built-in, workspace-local, dependency/extension-pack, and concurrent-management
  behavior remain outside the supported scope. A target that participates in an installed
  dependency or extension-pack relationship is ineligible rather than experimentally attempted.
- Automated tests pin known/unknown relationship evidence, idempotence, command arguments,
  non-local rejection, fallback routing, the application-scoped setting, and post-command
  verification. A sandboxed VS Code integration
  test reproduces the one-argument failure, proves the two-argument transition, verifies the
  already-applied no-op, and records behavior on both current and minimum supported VS Code.
- Repository guidance and the dated Spike B record are corrected to preserve both the original
  failed one-argument probe and the later successful two-argument evidence.
