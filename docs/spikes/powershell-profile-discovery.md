# Passive PowerShell profile discovery

**Date:** 2026-11-12
**Status:** Research findings; runtime resolver implementation remains undecided

## Product constraint

Passive discovery is the default. Runtime discovery that launches PowerShell
is a last resort because of potential latency and EDR detections; it is not
categorically prohibited. Q6b confirms an explicit **Resolve Using PowerShell...**
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

The .NET tool entry-point path must not be mistaken for PSHOME. Released source
explicitly distinguishes the global-tool launcher location from the actual
application directory.
Source: [v7.5.4 global-tool handling](https://github.com/PowerShell/PowerShell/blob/v7.5.4/src/Microsoft.PowerShell.ConsoleHost/host/msh/ConsoleHost.cs#L118).

Confirmed product decision (Q12): display current-user profiles once per
edition/family and distinguish actual installation roots for all-users profiles
only when multiple supported roots are discovered. Installation channels and
package types are descriptive metadata; no installation selector is needed.
Preview/custom discovery deferral is unchanged.

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

Choose and validate a Windows resolver that works from the extension without
launching PowerShell. Native known-folder access and best-effort registry lookup
have different packaging and reliability tradeoffs. Confirm any fallback result
before offering creation at an uncertain destination.

Validate Windows PowerShell 5.1 paths separately from current PowerShell source.
Also validate standard installation layouts, executable symlinks, Unix XDG
behavior, missing destinations, multiple OneDrive folders, and inaccessible paths.
These are development checks. A runtime PowerShell fallback must follow the
explicit-action, timeout, and session-cache policy confirmed in Q6b.

Source links to moving branches describe the inspected implementations; pin
relevant revisions when implementing.
