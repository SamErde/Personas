# Implementation prompt: current workspace extension status

Implement the approved plan in `docs/plans/2026-08-10-current-workspace-extension-status.md` for the Personas VS Code extension.

Start by reading `CLAUDE.md`, the plan, and the current implementations of `src/core/inventory.ts`, `src/core/types.ts`, `src/servicesFactory.ts`, `src/panel/matrixPanel.ts`, `src/panel/welcomeView.ts`, and the two webviews. Verify the worktree and branch before editing; preserve unrelated user changes. Use a dedicated feature branch if the user has not already provided one. Do not commit, push, open a PR, publish, or change versions unless the user explicitly asks.

The required outcome is:

- Show one read-only **Current workspace** card in the Personas activity pane whenever a folder or workspace is loaded.
- When that workspace has a saved local `.code-workspace` JSON manifest, provide explicit
  read-only **Open manifest** and direct **Edit manifest** actions on the card. These are file
  actions only and must not be presented as extension-enablement controls.
- Show one read-only, visually separated **Current workspace** column after the profile columns in the Extension Matrix.
- Report `Enabled`, `Not enabled`, `Not installed in profile`, `Workspace-local`, or `Unknown` using the evidence and precedence defined in the plan.
- Include unpacked local workspace extensions under `.vscode/extensions`, including workspace-only rows.
- Keep recommendations out of scope.

Honor these hard boundaries:

- Ordinary extensions remain installed per profile; workspace state is not a synthetic profile.
- Do not add workspace IDs to `Inventory.profiles` or `ExtensionRecord.installedIn`.
- Do not read or write `state.vscdb`; do not add SQLite.
- Do not use proposed/private VS Code APIs or internal commands.
- Do not use `Extension.isActive` as an enablement signal.
- Do not add enable/disable/install controls to the workspace card or column.
- A workspace-only row must not expose profile cell toggles or profile bulk actions.
- Do not treat `.vscode/extensions.json` recommendations as installation state.
- Do not expand remote-workspace support or weaken the existing development-host safety guard.
- Never write VS Code profile manifests or internal state files directly.

Execute the plan in order. First run and document the supported-API spike in `docs/spikes/workspace-extension-status.md`. Test `vscode.extensions.all`/`onDidChange`, local workspace extension locations, current profile associations, and extension-host visibility in a disposable VS Code sandbox. If the spike contradicts a planned claim, use `Unknown` for that case and document it. Do not compensate with SQLite, internal commands, or guessed defaults.

Keep the architecture testable:

- Parse optional `profileAssociations.workspaces` defensively.
- Add a pure/injected workspace-status module for identity resolution, local candidate discovery, status composition, and counts.
- Adapt stable VS Code APIs only in the host layer.
- Keep the workspace inventory separate from the profile inventory and mutation helpers.
- Use the existing debounced refresh path and correctly dispose extension/workspace/file watchers.
- Use exact, accessible status text and tooltips; do not rely on color alone.
- Fall back to the existing letter tile for workspace-only extension icons.

Add comprehensive unit tests for parsing, URI normalization, profile resolution, candidate safety, duplicates, every status state, unknown/failure paths, workspace-only row behavior, activity-pane counts, and no-workspace behavior. Extend the integration harness only with disposable `--user-data-dir`, `--extensions-dir`, and workspace fixtures; it must not touch the user's real VS Code state.

Update `README.md` with the distinction among profile installation, workspace enablement, local workspace extensions, and recommendations. Do not edit `package.json` or `package-lock.json` versions; release-please owns versioning.

Before reporting completion, run:

```text
npm run lint
npm test
npm run build
npm run test:integration
git diff --check
```

Also complete the disposable-sandbox manual acceptance checklist from the plan. In the final handoff, lead with the implemented behavior, list any remaining `Unknown` cases with evidence, report every validation command and result, and link the principal changed files. Do not claim exact workspace disable reasons that the stable API does not expose.
