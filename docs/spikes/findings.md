# Spike A — state-file semantics findings

**Machine:** Windows 11, VS Code Stable 1.127.0 (`4fe60c8b1cdac1c4c174f2fb180d0d758272d713`), running during the spike.
**Script:** `scripts/spike-formats.mjs` (read-only; run with no args to use platform defaults).
**Date:** 2026-07-03

## Step 1-2: `scripts/spike-formats.mjs` output vs. the plan's "Verified file-format facts"

Ran `node scripts/spike-formats.mjs` against the live `%APPDATA%\Code` and `~/.vscode/extensions`.

### Fact 1 — profile registry (`storage.json` -> `userDataProfiles`)

Confirmed. The `userDataProfiles` array in storage.json holds one entry per named profile; the default profile is absent from the list, exactly as documented. Trimmed real output:

```json
[
  {
    "location": "4328b3eb",
    "name": "Blog",
    "icon": "book",
    "useDefaultFlags": { "keybindings": true, "settings": true }
  },
  {
    "location": "builtin/agents",
    "name": "Agents",
    "useDefaultFlags": {
      "settings": true,
      "keybindings": true,
      "prompts": true,
      "mcp": true,
      "languageModels": true,
      "snippets": true,
      "tasks": true,
      "extensions": true
    }
  }
]
```

Also observed: `location` can be a bare hex id (`4328b3eb`) or a slash-containing path (`builtin/agents`), confirming the plan's note that location may contain `/`. `icon` is present on user-created profiles and absent on the built-in "Agents" profile.

### Fact 2 — `useDefaultFlags.extensions: true` = inherits default profile's extensions

Confirmed. Only "Agents" sets `useDefaultFlags.extensions: true`, and it has no `extensions.json` file under its profile folder (script reports `own=none`). The other four named profiles ("Blog", "Work", "Maester", ".NET Projects") omit `extensions` from `useDefaultFlags` (implicitly false) and each has its own `extensions.json`, including one with zero entries (".NET Projects", `own=0` — an empty-but-present array, distinct from "no file").

```
profile "Blog" (4328b3eb) inheritsExtensions=false own=11
profile "Work" (7cdc4d19) inheritsExtensions=false own=11
profile "Maester" (6d1aeaf5) inheritsExtensions=false own=8
profile ".NET Projects" (3360ee34) inheritsExtensions=false own=0
profile "Agents" (builtin/agents) inheritsExtensions=true own=none
```

This confirms parsers must treat "own=0" (empty array, independent list) and "own=none" (no file, inherits) as distinct states, not collapse both to "no extensions."

### Fact 3 — per-profile `extensions.json` schema

Confirmed, with more metadata fields present in practice than the plan's minimal schema (harmless — extra fields, parser should ignore unknowns). Trimmed real entry from Blog's `extensions.json`:

```json
{
  "identifier": {
    "id": "ginfuru.vscode-jekyll-snippets",
    "uuid": "7891ba3a-fe11-4e55-bf8f-21479bed022c"
  },
  "version": "0.9.3",
  "location": {
    "$mid": 1,
    "path": "/c:/Users/SamErde/.vscode/extensions/ginfuru.vscode-jekyll-snippets-0.9.3",
    "scheme": "file"
  },
  "relativeLocation": "ginfuru.vscode-jekyll-snippets-0.9.3",
  "metadata": {
    "installedTimestamp": 1771712642827,
    "pinned": false,
    "source": "gallery",
    "isApplicationScoped": false
  }
}
```

`identifier.id`, `version`, `relativeLocation`, and `metadata.isApplicationScoped` (when present) all match the plan's fact. `identifier.uuid` and a larger `metadata` object (timestamps, publisher info, pre-release flags) are also present but not required by the plan's parser scope.

### Fact 4 — global manifest = default profile's list, and does not include profile-only extensions

Confirmed. `~/.vscode/extensions/extensions.json` had 42 entries vs. 66 folders on disk at the start of the spike (67 after the temporary hexeditor install, see Step 2). The delta is extensions installed only into named profiles (e.g. `ginfuru.vscode-jekyll-snippets`, seen in Blog's list above, does not appear in the global manifest).

### Fact 5 — `metadata.isApplicationScoped: true`

Confirmed. 21 entries in the global manifest carry `isApplicationScoped: true` (e.g. `esbenp.prettier-vscode`, `github.vscode-pull-request-github`, `anthropic.claude-code`). Sample entry:

```json
{
  "identifier": { "id": "johnpapa.vscode-peacock", "uuid": "5a7017bf-c571-4d77-b902-6e56b16f539a" },
  "version": "4.2.2",
  "relativeLocation": "johnpapa.vscode-peacock-4.2.2",
  "metadata": { "isApplicationScoped": true }
}
```

Cross-check: `code --profile "Blog" --list-extensions` returned the union of Blog's 11 own entries plus the application-scoped set (31 total, minus any name overlap), consistent with app-scoped extensions being visible in every profile regardless of that profile's own `extensions.json`.

### Fact 6 — extension pool + `.obsolete`

Confirmed. All versions live as `<publisher.name>-<version>[-<platform>]` folders directly under `~/.vscode/extensions`. `.obsolete` is a flat JSON object mapping folder name to `true`, e.g.:

```json
{
  "analysis-services.tmdl-1.6.3": true,
  "ms-toolsai.jupyter-2025.9.1-win32-x64": true,
  "anthropic.claude-code-2.1.96-win32-x64": true
}
```

New observation (not previously documented): after the Step 2 uninstall (below), `ms-vscode.hexeditor-1.11.1` appeared as a new `.obsolete` entry, and the folder itself was still present on disk (67 folders, up from 66). This confirms `.obsolete` is VS Code's own deferred-deletion marker — `--uninstall-extension` marks a folder obsolete immediately but the physical folder is swept later (on next full GUI session's extension GC), not synchronously by the CLI. Parsers/orphan logic (fact 7) should keep excluding `.obsolete`-marked folders from "orphan" regardless of whether they were marked by GUI or CLI action.

## Step 2: CLI profile-scoping check (`code --profile "Blog"`)

Ran the exact sequence against the real "Blog" profile:

```
$ code --profile "Blog" --list-extensions
anthropic.claude-code
bierner.github-markdown-preview
... (31 entries total, no hexeditor)

$ code --profile "Blog" --install-extension ms-vscode.hexeditor
Installing extensions...
Installing extension 'ms-vscode.hexeditor'...
Extension 'ms-vscode.hexeditor' v1.11.1 was successfully installed.

$ code --profile "Blog" --list-extensions
... (32 entries, ms-vscode.hexeditor present)

$ code --list-extensions          # default profile
... (hexeditor NOT present, grep for "hexeditor" returned no match)

$ code --profile "Blog" --uninstall-extension ms-vscode.hexeditor
Uninstalling ms-vscode.hexeditor...
Extension 'ms-vscode.hexeditor' was successfully uninstalled!

$ code --profile "Blog" --list-extensions
... (31 entries, identical to the pre-install list, hexeditor gone)
```

Full raw output is captured in `.superpowers/sdd/task-2-report.md`.

Verdict: install/uninstall via `code --profile <name>` are scoped strictly to the named profile. Installing into "Blog" did not touch the default profile's `--list-extensions` output, and uninstalling from "Blog" left the default profile and every other profile untouched. Re-running `scripts/spike-formats.mjs` after the sequence showed Blog's own `extensions.json` count back at 11 (its pre-spike value) and the global manifest still at 42 entries — no leakage in either direction. MutationService (Task 8) can rely on `--profile` scoping without an extra guard for install/uninstall crossing profile boundaries.

The one side effect (folder + `.obsolete` entry lingering until VS Code's own GC) is normal CLI/product behavior, not something the spike introduced or needs to work around — it does not appear in any profile's `extensions.json` and is already covered by fact 7's "not-orphan while obsolete" rule.

## Deviations from the plan's "Verified file-format facts"

None of facts 1-7 were contradicted. Two refinements to record for later tasks:

- Fact 2 needs a third state, not just "inherits" vs. "has own list": an own `extensions.json` can be present but empty (`own=0`, seen on ".NET Projects"). Parsers (Task 6) must distinguish "own file, empty array" from "no file, inherits" from "own file, N entries."
- Fact 6 is extended: CLI-driven uninstalls, like GUI uninstalls, defer physical folder deletion and go through the same `.obsolete` marking — confirmed empirically rather than assumed.

No task adjustments are required as a result; both are refinements within the existing model, not breaking changes.

## To re-verify on macOS/Linux

Schema is platform-independent (confirmed above); only paths need re-checking. CI integration tests (Task 12) cover Linux automatically via `@vscode/test-electron`; macOS needs a manual one-time run of this same script. Checklist:

- [ ] `userData` default resolves correctly: `~/Library/Application Support/Code` (macOS) / `~/.config/Code` (Linux) — confirm `storage.json` lives at `<userData>/User/globalStorage/storage.json` on both.
- [ ] `extDir` default resolves correctly: `~/.vscode/extensions` on both macOS and Linux (same as Windows, no AppData-style redirect).
- [ ] Profile folders still live at `<userData>/User/profiles/<location>/extensions.json` (location may contain `/`, e.g. `builtin/agents`) — confirm no path-separator quirks with POSIX paths.
- [ ] `.obsolete` format (flat JSON object, folder name to `true`) is unchanged.
- [ ] `code --profile "<name>" --install-extension` / `--uninstall-extension` remain scoped to the named profile only (re-run the Step 2 sequence against a disposable profile — do not reuse a profile with real user data on a shared macOS/Linux test machine).
- [ ] Folder naming convention `<publisher.name>-<version>[-<platform>]` — confirm the `-<platform>` suffix pattern (e.g. `-darwin-arm64`, `-linux-x64`) matches what Task 6's folder-name parser expects.
