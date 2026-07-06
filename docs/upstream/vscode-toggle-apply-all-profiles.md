# Draft: VS Code feature request — programmatic access to "Apply Extension to all Profiles"

> Status: DRAFT — not yet filed. Target repo: microsoft/vscode. Review before posting.

**Proposed title:** Expose a public command or API to toggle "Apply Extension to all Profiles" for a given extension ID

## Problem

Extensions that help users manage VS Code profiles have no supported way to toggle an
extension's application scope (the "Apply Extension to all Profiles" context-menu action in
the Extensions view). The state is readable on disk (`metadata.isApplicationScoped` in
`extensions.json`), but the only toggle is the built-in UI action.

The internal command `workbench.extensions.action.toggleApplyToAllProfiles` is registered,
but it is not invocable by extensions: it expects the workbench's internal `IExtension`
view-model instance. We verified this empirically in a sandboxed instance (VS Code 1.127.0,
`@vscode/test-electron`): invoking it via `vscode.commands.executeCommand` with an extension
ID string, `{ id }`, `[id]`, and a real public `vscode.Extension` object all fail with the
same `TypeError: Cannot read properties of undefined (reading 'location')`, and
`isApplicationScoped` never changes on disk (49 attempts across two runs; full methodology
available on request).

## Use case

[Personas](https://github.com/SamErde/Personas) shows an
extensions × profiles matrix and lets users install/uninstall per profile through the
`code` CLI. Users naturally expect to toggle "apply to all profiles" from the same matrix.
Today the best we can do is deep-link the Extensions view (`workbench.extensions.search`
with `@id:`) and instruct the user to right-click — a dead end other profile-management
extensions will also hit.

## Ask (either would work)

1. Make the existing toggle command accept an extension ID argument (precedent:
   `workbench.extensions.installExtension` and `workbench.extensions.uninstallExtension`
   accept IDs), or
2. Add a small API surface (or CLI flag, e.g. `code --apply-to-all-profiles <id>`) to get/set
   an extension's application scope.

Writing `extensions.json` directly is not a viable workaround while VS Code is running —
the extension scanner owns those files, and racing it risks corrupting the user's install.

## Notes for filing

- Search for existing issues first (`repo:microsoft/vscode apply to all profiles command`)
  and 👍/comment instead of filing a duplicate if one exists.
- Label suggestion: `extensions`, `user-profiles`, `api-proposal`.
