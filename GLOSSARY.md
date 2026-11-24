# Personas

Personas manages one developer's identity setup across their tools: which extensions each VS Code profile carries, and which Git identity each repository commits with.

## Language

### Personas

**Persona**:
One person's identity setup across their tools, made up of tool-specific parts such as a Git persona.
_Avoid_: using "persona" for a VS Code profile

**Git persona**:
A saved, named Git commit identity: a display name plus a Git `user.name` and `user.email`.
_Avoid_: identity profile, Git profile

### VS Code profiles and extensions

**Profile**:
A VS Code profile, always in VS Code's own sense; never called a persona.
_Avoid_: persona, workspace profile

**Agents window profile**:
VS Code's built-in profile (registry location `builtin/agents`) for its separate Agents window. It shares the Default profile's extensions and settings directly, and is not an ordinary profile: it does not become active just because an agent is running.
_Avoid_: Agents profile, agent profile

**Applied to all profiles**:
An extension VS Code itself marks with "Apply Extension to all Profiles", installed once and present in every profile.
_Avoid_: app-scoped, application-scoped, shared, ALL

**Not enabled**:
An extension that is installed but not running in the current workspace, for a reason Personas cannot determine (one possibility is that it is disabled for the workspace).
_Avoid_: disabled, disabled (workspace)

**Install in every profile**:
A Personas bulk operation that installs an extension separately into each profile; distinct from an extension being applied to all profiles.
_Avoid_: install everywhere, install in all profiles

### PowerShell

**PowerShell profile**:
A startup script stored at a standard, user- and host-scoped location that PowerShell loads automatically when starting a session with profile loading enabled. It customizes the shell through variables, functions, modules, prompts, and other session settings.
_Avoid_: unqualified "profile", VS Code profile, persona

### Git configuration

**Current repository**:
The repository the Git Configuration view reports on: the one containing the active editor's file, or else the first workspace folder.
_Avoid_: active repository, selected repository

**Effective configuration**:
Every Git config value that applies to the current repository, in the order Git reads it. For a single-valued key the last value wins.
_Avoid_: resolved config, merged config

**Include status**:
Whether a file named by an `include` or `includeIf` rule takes part in the effective configuration: Applied, Not applied here, Empty, or Missing. Inferred from Git's own output; Personas does not evaluate conditions.
_Avoid_: matched, active, enabled

### Product surfaces

**Home**:
The Personas sidebar, made up of one view per area: VS Code Profiles, PowerShell Profiles, and Git Configuration.
_Avoid_: welcome view, dashboard

**Git Configuration**:
The Home view that shows the Git identity in effect for the current repository and the config files it comes from. Read-only.
_Avoid_: gitconfig pane, Git settings

**Extension Matrix**:
The Personas panel that shows every extension against every profile.
_Avoid_: profile matrix, extensions grid
