# Personas: Git Identity Personas Design

**Date:** 2026-07-09
**Status:** Approved design, pending implementation plan

## Purpose

Personas is expanding from a VS Code profile extension matrix into a broader developer persona manager. The first new compartment is deliberately narrow: help users see, save, bind, and safely apply Git commit identity for local desktop repositories.

The core problem is that Git identity is often implicit. Many users set `user.name` and `user.email` globally once, then override them only for work or special repositories. More advanced users may rely on conditional includes, where directory-scoped config files override the global default. Personas should make the effective identity visible, show where it came from when possible, and let the user apply an intended identity to a specific repository without changing global Git configuration.

## Goals

V1 provides:

- A synced catalog of Git identity personas.
- Git identity audit for selected local repositories.
- Source reporting for `user.name` and `user.email`, including exact source paths when Git can provide them.
- Persona creation from the current effective Git identity, including inherited global/default config.
- Local-only repo-root bindings from a repository to a saved Git persona.
- Preview-and-confirm apply that writes only repo-local Git config.
- Post-apply verification by re-reading effective Git identity.
- Warnings for visible Git identity environment-variable overrides.
- A repo picker when more than one local Git repository is open.
- A compartmentalized Personas activity sidebar that summarizes profile/extension and Git identity capabilities separately.

## Non-Goals

V1 does not provide:

- Global or user-level `.gitconfig` mutation.
- Directory-scoped `includeIf` management.
- VS Code profile to Git persona associations.
- Git signing configuration.
- Credential policy management.
- Remote, WSL, containers, or github.dev Git identity management.
- A dedicated Git identity webview editor.
- Bulk dashboard management for every repository in a workspace.

## Product Model

Personas does not make either VS Code profiles or Git configuration the single source of truth for all persona data. They are related domains, but not the same domain.

- VS Code remains authoritative for VS Code profiles and installed extensions.
- Git remains authoritative for effective repository identity.
- Personas owns user intent: saved persona definitions and optional local repo-root bindings.

V1 Git personas are independent from VS Code profiles. The activity sidebar may show the current VS Code profile as context, but V1 does not store or enforce profile to Git persona associations.

## Storage

The persona catalog is stored in `ExtensionContext.globalState` as JSON-serializable data and registered for Settings Sync with `globalState.setKeysForSync(...)`.

Repo bindings are stored locally only. They contain absolute repository roots, so they must not sync by default. Absolute paths are machine-specific and may reveal private directory structure.

No primary V1 catalog data is stored in a JSON file under `globalStorageUri`. That directory remains available for future local-only data if a later feature needs file storage.

## Data Model

```ts
interface GitPersona {
  id: string;
  displayName: string;
  gitUserName: string;
  gitUserEmail: string;
  createdAt: string;
  updatedAt: string;
}

interface RepoPersonaBinding {
  repoRoot: string;
  personaId: string;
  updatedAt: string;
}

interface GitIdentityValue {
  key: "user.name" | "user.email";
  value?: string;
  sourceType:
    | "local"
    | "global"
    | "included"
    | "system"
    | "env-visible"
    | "unset"
    | "unknown";
  sourcePath?: string;
}

interface GitIdentityAudit {
  repoRoot?: string;
  values: GitIdentityValue[];
  visibleEnvOverrides: {
    GIT_AUTHOR_NAME?: string;
    GIT_AUTHOR_EMAIL?: string;
    GIT_COMMITTER_NAME?: string;
    GIT_COMMITTER_EMAIL?: string;
  };
}
```

`repoRoot` is optional in `GitIdentityAudit` because Personas can still show global/default Git identity context when no local Git repository is open.

`RepoPersonaBinding.repoRoot` is a normalized binding key, not raw UI input. Personas derives it from the detected Git repository root, resolves it to an absolute real path, normalizes path separators and trailing separators, and applies platform-appropriate case normalization before storage or comparison. UI can still display the original path, but lookup must always use the normalized key so symlinks, casing differences, and alternate workspace openings do not create duplicate bindings for the same checkout.

## Architecture

V1 adds a Git identity subsystem beside the existing profile/extension subsystem.

### PersonaCatalogService

Stores and validates Git personas in `context.globalState`. It registers the persona catalog key for Settings Sync. It exposes create, update, delete, list, and get operations, and rejects incomplete personas without `displayName`, `gitUserName`, or `gitUserEmail`.

### RepoBindingService

Stores local-only mappings from Git repo root to persona ID. Bindings use the Git repository root, not the VS Code workspace folder, because V1 apply writes repo-local config. If a binding points to a missing persona, the service reports it as stale instead of guessing a replacement.

The service never stores a raw workspace path as the binding key. It accepts only the normalized repo-root key produced by `GitIdentityService`.

### GitIdentityService

Detects local Git repositories, reads effective identity, captures source provenance, detects visible environment overrides, applies persona values to local repo config, and verifies the result.

The service should prefer Git-provided provenance, such as config output that includes origin and scope, but the product contract is "best available source path." If exact source path cannot be determined in a Git version or environment, Personas still shows a source type.

Apply writes only:

```bash
git config --local user.name <persona.gitUserName>
git config --local user.email <persona.gitUserEmail>
```

The apply operation must protect against partial writes. Before changing values, `GitIdentityService` captures the existing repo-local `user.name` and `user.email` state. If either write fails before verification completes, the service attempts to restore each changed key to its previous local value, or unset it if it was previously inherited. If rollback also fails, Personas reports the partial state explicitly and does not claim the persona was applied.

### IdentityCommandController

Owns native VS Code command flows using Quick Pick, InputBox, and modal confirmation APIs. It resolves or prompts for a repository, calls the services, presents previews, and refreshes the sidebar state after changes.

### Personas Sidebar Home

The existing activity sidebar becomes a compartmentalized home surface:

- **VS Code Profiles / Extensions** summarizes the current matrix capability and opens the Profile x Extensions matrix.
- **Git Identity Personas** summarizes saved persona count and current repo identity status, then launches identity commands.
- **Persona Associations** is reserved as a future concept but is not interactive in V1.

## UX Flows

### Audit Git Identity

Command: **Personas: Audit Git Identity**

1. Detect local Git repositories in the workspace.
2. If multiple repositories are present, require the user to choose one.
3. If one repository is present, use it.
4. If no repository is present, show "No local Git repository found" and show global/default identity context instead.
5. Show effective `user.name` and `user.email`.
6. Show source type and source path when available.
7. Show saved persona match, repo binding, and visible env override warnings.

When no local repository is open, Personas may show global/default identity and unconditional included config. It must not claim that a directory-scoped `includeIf "gitdir:..."` rule would apply without a repository path to evaluate.

### Create Git Persona from Current Identity

Command: **Personas: Create Git Persona from Current Identity**

1. Resolve or select a local repository when available.
2. If no repository is available, read global/default identity context.
3. Pre-fill persona fields from the effective identity.
4. Let the user edit display name, Git name, and Git email.
5. Save the persona to the synced catalog after confirmation.

### Bind Git Persona to Current Repo

Command: **Personas: Bind Git Persona to Current Repo**

1. Resolve or select a local repository.
2. Let the user choose a saved Git persona.
3. Save a local repo-root to persona ID binding.
4. Do not write Git config as part of binding.

This command is unavailable when no local repository is open.

### Apply Git Persona to Current Repo

Command: **Personas: Apply Git Persona to Current Repo**

1. Resolve or select a local repository.
2. Let the user choose a saved persona, defaulting to the bound persona when present.
3. Show a preview with:
   - repo root
   - current effective name and email
   - current source type and source path where available
   - desired name and email
   - exact local keys to write
4. Require explicit confirmation.
5. Run repo-local `git config` writes.
6. Re-read effective identity.
7. Report verified success only if effective name and email match the selected persona.
8. If visible Git identity environment variables exist, warn that commits may still use env-provided identity.
9. If any write or verification step fails, attempt rollback to the previous repo-local state and report the result.

This command is unavailable when no local repository is open.

## Error Handling

- **No Git repo:** show "No local Git repository found"; show global/default identity context if available; offer persona creation and persona management; do not offer bind or apply.
- **Multiple repos:** require explicit repo selection before audit, bind, or apply.
- **Remote workspace:** show unsupported/read-only V1 messaging.
- **Missing Git executable:** show a clear unavailable state and do not offer apply.
- **Git config read failure:** show command failure details and do not infer identity.
- **Missing persona fields:** prevent save and apply until display name, Git name, and Git email are present.
- **Stale repo binding:** show the missing persona reference and offer to choose a new persona or remove the binding.
- **Apply mismatch:** show expected values, actual values, and source details after verification.
- **Apply rollback failure:** show the previous local values, attempted desired values, and current effective values so the user can repair the repo config.
- **Visible env override:** warn that commits may use environment-provided identity even when Git config matches.

## Testing

Unit tests:

- Persona catalog validation and sync-key registration.
- Repo binding storage remains local-only.
- Repo binding keys are normalized before storage and lookup.
- Git config provenance parsing into source type and optional path.
- Apply preview generation.
- Apply rollback behavior for failed partial writes.
- Env override warning detection.
- No-repo global/default identity display behavior.
- Stale binding behavior.

Integration-style tests with temporary Git repos:

- Inherited global/default identity using isolated Git config environment.
- Repo-local identity override.
- `includeIf`-derived identity.
- Multiple repository selection flow boundaries, using service-level seams where UI cannot be directly tested.
- Apply writes only `.git/config`.
- Post-apply verification detects match and mismatch.

Existing matrix/profile tests remain in place and should not be weakened by this work.

## Future Specs

### Identity Webview Editor

A V2 identity editor can show the persona catalog, audit details, config provenance, and apply preview in a richer UI than Quick Pick flows. V1 intentionally uses native commands to keep the first identity feature small.

### Directory Persona Rules

A V2 or later feature should manage directory-scoped Git persona rules with conditional includes, such as:

```text
~/Repositories/GitHubPersonal
~/Repositories/GitHubWork
~/Repositories/GitLabPersonal
~/Repositories/Work2
```

That feature should treat rules as a higher-level persona scope. When a directory persona rule is explicit and safe, Personas should prefer writing identity changes to the highest relevant persona scope instead of always writing directly to repository-local config. Because this may require user-level `.gitconfig` mutation and can affect many repositories, it must preview exact include rules, config files, and affected directory patterns before writing.

### Persona Associations

A future association feature can connect VS Code profile personas with Git identity personas. It should remain optional because some users have many VS Code profiles and one Git identity, while others have one VS Code profile and many Git identities.

### Signing and Credential Policies

Signing and credential controls should be separate compartments, not hidden fields in the V1 identity model. They may eventually belong in persona rules or directory persona scopes, but V1 tracks only `user.name` and `user.email`.
