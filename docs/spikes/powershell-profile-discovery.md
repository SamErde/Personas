# Passive PowerShell profile discovery

**Date:** 2026-11-12
**Status:** Research findings. The decisions they led to shipped in 1.3.0 and are recorded in
[ADR-0005](../adr/0005-powershell-discovery-is-passive-first.md): passive discovery first, a
`reg.exe` Documents resolver on Windows that requires two registry values to agree, and opt-in
runtime discovery labeled **Run … to resolve**. The decisions marked Q6a, Q6b, and Q12 below were
confirmed with the owner during design.

## Product constraint

Passive discovery is the default. Runtime discovery that launches PowerShell
is a last resort because of potential latency and EDR detections; it is not
categorically prohibited. Q6b confirms an explicit runtime action (shipped as **Run … to resolve**)
action after passive discovery fails, with profiles disabled, a short timeout,
and successful results cached for the session. Ordinary refreshes do not launch it.
Querying PowerShell during development research or validation is permitted.
Discovery must distinguish authoritative paths from fallback candidates.

## Primary-source findings

- PowerShell resolves current-user profile paths through its platform
  configuration directory. On Windows that directory uses
  `Environment.SpecialFolder.Personal` with `DoNotVerify`, followed by
  `PowerShell`. On Unix, a nonempty `XDG_CONFIG_HOME` supplies the base;
  otherwise the base is `HOME/.config`, followed by `powershell`.
  Sources: [HostUtilities](https://github.com/PowerShell/PowerShell/blob/master/src/System.Management.Automation/engine/hostifaces/HostUtilities.cs),
  [CorePsPlatform](https://github.com/PowerShell/PowerShell/blob/master/src/System.Management.Automation/CoreCLR/CorePsPlatform.cs).
- The current .NET Windows implementation maps Personal/MyDocuments to the
  Documents known folder and calls `SHGetKnownFolderPath`. It does not supply
  a USERPROFILE fallback for a failed Documents lookup.
  Source: [Environment.Windows.cs](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Environment.Windows.cs).
- A matching Windows known-folder lookup must preserve redirection:
  `KF_FLAG_DEFAULT_PATH` requests the default rather than redirected path,
  while `KF_FLAG_CREATE` can create the folder. `KF_FLAG_DONT_VERIFY`
  avoids checking that the destination exists.
  Source: [KNOWN_FOLDER_FLAG](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/ne-shlobj_core-known_folder_flag).
- Microsoft documents Personal under User Shell Folders in connection with
  redirected personal folders. This is useful fallback evidence, not proof that
  reading that registry value is equivalent to the known-folder API.
  Source: [Microsoft folder-redirection guidance](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/change-personal-folder-location-fails).
- Microsoft's VS Code PowerShell extension locates installation candidates using
  filesystem and environment checks in its platform discovery code. This
  demonstrates that discovering installation paths need not launch PowerShell;
  it does not mean the extension never launches PowerShell for other purposes.
  Source: [vscode-powershell platform.ts](https://github.com/PowerShell/vscode-powershell/blob/main/src/platform.ts).
- The documented powershell.config.json settings do not expose a profile-directory
  override. Its current-user location is relative to the profile directory,
  so finding this config file is not an independent authoritative resolver.
  Source: [about_PowerShell_Config](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_config).

## Installation types and profile sharing

Released PowerShell source gives current-user profiles a platform configuration
root, without a stable/Preview/installer-specific namespace: resolved
Documents/PowerShell on Windows, and XDG_CONFIG_HOME/powershell or
HOME/.config/powershell on Unix. Windows PowerShell 5.1 instead uses
Documents/WindowsPowerShell. These statements assume the same user, host, and
configuration environment.

Sources: [PowerShell v7.5.4 platform paths](https://github.com/PowerShell/PowerShell/blob/v7.5.4/src/System.Management.Automation/CoreCLR/CorePsPlatform.cs),
[Windows PowerShell profiles](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles?view=powershell-5.1).

All-users profiles use the application base, corresponding to actual PSHOME.
Different installation roots can therefore have different all-users scripts even
when current-user scripts are shared. The application base is resolved from the
directory containing System.Management.Automation.dll.

Sources: [v7.5.0 profile construction](https://github.com/PowerShell/PowerShell/blob/v7.5.0/src/System.Management.Automation/engine/hostifaces/HostUtilities.cs),
[v7.5.4 application base](https://github.com/PowerShell/PowerShell/blob/v7.5.4/src/System.Management.Automation/engine/Utils.cs).

Microsoft's macOS installation documentation explicitly lists different stable
and Preview PSHOME directories with the same current-user profile directory.
Portable installation locations can differ too. MSIX installation directories are
read-only: current-user profiles are supported, but creating or modifying
all-users profiles is not.

Sources: [macOS installation paths](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-macos),
[Windows installation limitations](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows).

The Microsoft Store installation is started through the app execution alias
`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe`. Node cannot `stat` or `realpath`
that alias (both fail with `EACCES`), but `readlink` returns the executable inside
the package folder, and that folder is the PSHOME the installation reports.
Verified on Windows with Node 24.22.3 and the Microsoft.PowerShell 7.7.0 Store
package (2026-11-14).

The .NET tool entry-point path must not be mistaken for PSHOME. Released source
explicitly distinguishes the global-tool launcher location from the actual
application directory.
Source: [v7.5.4 global-tool handling](https://github.com/PowerShell/PowerShell/blob/v7.5.4/src/Microsoft.PowerShell.ConsoleHost/host/msh/ConsoleHost.cs#L118).

Confirmed product decision (Q12): display current-user profiles once per
edition/family and distinguish actual installation roots for all-users profiles
only when multiple supported roots are discovered. Installation channels and
package types are descriptive metadata; no installation selector is needed.
Standard Preview discovery is tracked in
[#183](https://github.com/SamErde/Personas/issues/183). Its initial contract is limited to the
documented Microsoft Preview layouts: `%ProgramFiles%\PowerShell\7-preview` and the
`Microsoft.PowerShell.Preview` MSIX package through
`%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh-preview.exe` on Windows,
`/usr/local/microsoft/powershell/7-preview` on macOS, and
`/opt/microsoft/powershell/7-preview` on Linux. The runtime probe remains authoritative for
the canonical installation root. That work adds no candidates for PATH scans, user-selected
archive destinations, Homebrew, Snap, .NET global-tool Preview, or generic custom installations.
Discovery cannot infer installer provenance: an archive placed at an included canonical path is
indistinguishable from that layout and can be discovered.
See the Microsoft installation guidance for
[Windows](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows),
[macOS](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-macos),
and [Linux](https://learn.microsoft.com/powershell/scripting/install/install-ubuntu).

## VS Code host clarification

The PowerShell extension starts Editor Services with host profile ID
Microsoft.VSCode. Its extension terminal differs from an ordinary PowerShell
terminal in VS Code. The latter uses the console-host profile.

Sources: [PowerShell extension session startup](https://github.com/PowerShell/vscode-powershell/blob/main/src/session.ts),
[extension terminal documentation](https://github.com/PowerShell/vscode-powershell/blob/main/docs/troubleshooting.md#completions-arent-appearing).

## Design implications and unresolved work

Confirmed product policy (Q6a): use Windows' resolved Documents location
before conventional or OneDrive candidate paths. An existing script in an old
folder is not sufficient evidence that PowerShell would load it. If the correct
destination is unresolved, show that status and withhold creation.

The Windows resolver that shipped is a best-effort registry lookup with `reg.exe`, used only
when `User Shell Folders` and `Shell Folders` agree (ADR-0005). It was chosen over native
known-folder access for packaging simplicity, with that agreement rule as the safeguard.

The remaining verification is a finite matrix: Windows PowerShell 5.1 paths,
supported PowerShell 7 layouts, XDG behavior, symlink states, inaccessible paths,
redirected Windows Documents resolution, and watcher recovery. Existing automated
coverage and missing hosted or live evidence are tracked separately in
[#184](https://github.com/SamErde/Personas/issues/184). Personas uses the resolved
Windows Documents location; it does not scan OneDrive candidate folders.

Source links to moving branches describe the inspected implementations; pin
relevant revisions when implementing.

## 2026-11-26 follow-up: canonical background probe

Issue #179 replaces the explicit-only runtime policy from ADR-0005. Personas now renders passive
installation evidence first, then starts each detected edition asynchronously with `-NoProfile`
and asks PowerShell itself for `$PSHOME` and `$PROFILE.CurrentUserAllHosts`. `-OutputFormat XML`
provides CLIXML that the extension decodes without requiring .NET calls in the probe script.

A forced `ConstrainedLanguage` check showed the four property reads work in both PowerShell 7 and
Windows PowerShell 5.1. That check proves the probe's language mechanics only; it does not prove
execution under an actually enforced App Control policy. The registry agreement resolver remains a
Windows fallback when runtime discovery is disabled or every detected executable fails.
