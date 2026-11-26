# Personas roadmap

This is what's planned for Personas. Each area links to its tracking issue, where you can follow progress or add your thoughts. Plans can change; the [changelog](../CHANGELOG.md) records what has actually shipped.

## Git personas ([#162](https://github.com/SamErde/Personas/issues/162))

A Git persona is a saved, named Git identity that you can apply to the right repositories.

- **Shipped in 1.5.0 (stage 1):** the read-only Git Configuration view. It shows the identity in effect, the config and include files it comes from, and the full effective configuration.
- **Next (stage 2):**
  - a persona catalog that syncs with Settings Sync;
  - creating a persona from the identity in effect;
  - binding a persona to a repository, kept on this machine only;
  - applying a persona to a repository, with a preview, a check afterwards, and a rollback if anything fails;
  - warnings when environment variables override the configured identity;
  - choosing the repository in multi-repository workspaces.
- **Later:**
  - linking Git personas to VS Code profiles;
  - a persona editor;
  - directory rules managed with `includeIf`;
  - signing and credential policies;
  - remote, WSL, and container windows.

## PowerShell Profiles ([#163](https://github.com/SamErde/Personas/issues/163))

- WSL windows are next, followed by SSH and dev container windows.
- Discovering PowerShell Preview and custom installations.
- Running or reloading a profile, templates for new profiles, and keeping profile content in sync.

## Extension Matrix and cleanup ([#164](https://github.com/SamErde/Personas/issues/164))

- Cleaning up stale profile folders and old versions of installed extensions.
- Creating, deleting, and renaming profiles from Personas.
- Showing translated extension display names.
- Whether extension sets or baselines belong in Personas is an open question: [#165](https://github.com/SamErde/Personas/issues/165).

## Waiting on VS Code

- An API for toggling **Apply Extension to all Profiles**, so the matrix can change it directly ([#166](https://github.com/SamErde/Personas/issues/166)).

## Verification

These checks have been identified but not yet run:

- the remaining manual workspace-status scenarios ([#167](https://github.com/SamErde/Personas/issues/167));
- confirming paths and command-line behaviour on macOS and Linux, and portable mode ([#168](https://github.com/SamErde/Personas/issues/168)).
