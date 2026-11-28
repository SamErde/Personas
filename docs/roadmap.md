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

- Research whether PowerShell Profiles can safely support the current WSL 2 Remote window
  ([#182](https://github.com/SamErde/Personas/issues/182)).
- Discover standard PowerShell Preview installations as part of the PowerShell 7 family
  ([#183](https://github.com/SamErde/Personas/issues/183)).
- Complete the finite discovery-validation matrix, distinguishing automated, hosted-integration,
  and live evidence ([#184](https://github.com/SamErde/Personas/issues/184)).

## Extension Matrix and cleanup ([#164](https://github.com/SamErde/Personas/issues/164))

- Cleaning up stale profile folders and old versions of installed extensions.
- Creating, deleting, and renaming profiles from Personas.
- Showing translated extension display names.

## Waiting on VS Code

- A supported, idempotent API for reading and changing **Apply Extension to all Profiles**. Personas has a guarded experimental action, but the upstream request is deliberately deferred and the native flow remains the supported fallback ([#166](https://github.com/SamErde/Personas/issues/166)).

## Verification

These checks have been identified but not yet run:

- the remaining manual workspace-status scenarios ([#167](https://github.com/SamErde/Personas/issues/167));
- confirming paths and command-line behaviour on macOS and Linux, and portable mode ([#168](https://github.com/SamErde/Personas/issues/168)).
