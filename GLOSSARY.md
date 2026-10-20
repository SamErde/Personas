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

**Applied to all profiles**:
An extension VS Code itself marks with "Apply Extension to all Profiles", installed once and present in every profile.
_Avoid_: app-scoped, application-scoped, shared, ALL

**Not enabled**:
An extension that is installed but not running in the current workspace, for a reason Personas cannot determine (one possibility is that it is disabled for the workspace).
_Avoid_: disabled, disabled (workspace)

**Install in every profile**:
A Personas bulk operation that installs an extension separately into each profile; distinct from an extension being applied to all profiles.
_Avoid_: install everywhere, install in all profiles

### Product surfaces

**Home**:
The Personas sidebar, divided into one section per area (Profiles & Extensions, Git Identity).
_Avoid_: welcome view, dashboard

**Extension Matrix**:
The Personas panel that shows every extension against every profile.
_Avoid_: profile matrix, extensions grid
