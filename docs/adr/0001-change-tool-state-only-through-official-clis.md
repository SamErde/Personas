# ADR-0001: Read each tool's state, change it only through that tool's official CLI

**Status:** Accepted

## Decision

Personas reads each tool's state directly (VS Code's profile registry and per-profile
extension lists on disk; Git config), but changes that state only through the tool's own
official CLI: `code` for VS Code profiles and extensions, and `git config --local` for a
repository's Git identity.

Today Personas only reads Git configuration: the Git Configuration view, stage 1 of Git
personas, never writes it. The `git config --local` path applies when a later stage applies
a Git persona to a repository (see ADR-0002 and
[#162](https://github.com/SamErde/Personas/issues/162)).

Exceptions:

- Deleting orphaned extension folders: the on-disk version folders of an extension that
  no profile references (an orphan is decided per extension ID; see `GLOSSARY.md`). No CLI
  command removes them, so Personas deletes them itself, to the
  trash and only after the user confirms.
- Managing PowerShell profile scripts: Personas may create and delete these files
  directly, while users edit their contents in the VS Code editor. These are
  user-authored startup scripts rather than tool-managed metadata; direct file
  management follows their normal editing model. Managing a file does not
  automatically execute it. See the "PowerShell Profiles" section of
  `docs/user-guide.md` for scope, ADR-0005 for how locations are found, and
  `docs/spikes/powershell-profile-discovery.md` for the discovery research.

## Reason

Each tool owns its state files and their formats can change without notice. Going through
the official CLI keeps writes valid under the tool's own rules, while reading the files
directly gives Personas the cross-profile view no public API offers. The verified facts behind
the reads are in `docs/spikes/findings.md`.

## Consequences

- Personas never writes `storage.json`, any `extensions.json`, or a Git config file directly.
  Opening a Git config file in the VS Code editor for the user to edit and save is not a write
  by Personas.
- Outside the exceptions above, a change that no official CLI supports (for example, toggling "Apply Extension to all
  Profiles") ships as a guided hand-off to the tool's own UI instead.
