# ADR-0005: PowerShell profile discovery is passive first; runtime discovery is opt-in

**Status:** Superseded by [ADR-0006](0006-resolve-powershell-profile-paths-in-the-background.md)

## Decision

Personas finds PowerShell installations and profile locations **without starting PowerShell**
(passive discovery), including on every refresh. Starting PowerShell to resolve a location
(runtime discovery) happens only when the user explicitly chooses **Run … to resolve** for a
named executable, and only while `personas.powerShellProfiles.allowRuntimeDiscovery` is on.
That setting defaults to off and is machine-scoped.

- On Windows, the Documents folder comes from the `Personal` value under both
  `User Shell Folders` (with environment variables expanded) and `Shell Folders`, read with
  `reg.exe`. Personas uses it only when the two agree. If they disagree, the current-user
  location is reported as unresolved, and Personas withholds Create rather than guess.
- A runtime result is kept for the rest of the session, even after the setting is turned off.
- A runtime probe starts the executable with profiles disabled (`-NoProfile`) and a
  five-second timeout.

## Reason

Starting PowerShell runs code the user may not expect: an execution environment, policies,
and possibly a slow startup. Discovery runs every time the view is shown, so it has to be
fast and side-effect free. The registry lookup is not proven to match the Windows known-folder
API in every case (see `docs/spikes/powershell-profile-discovery.md`). Requiring agreement
between the two registry values, and offering an explicit runtime check, accepts that risk
without ever creating a profile in the wrong place.

## Consequences

- Most users never need runtime discovery. When it's needed, the view says
  **Runtime discovery is off** and links to the setting.
- Refresh never starts PowerShell.
- At the time of this decision, Windows PowerShell 5.1 paths, symlinks, XDG layouts, and
  inaccessible paths still needed validation. The remaining finite matrix is tracked in
  [#184](https://github.com/SamErde/Personas/issues/184).
