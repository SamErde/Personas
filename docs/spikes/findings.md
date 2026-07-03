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

How the profile list was checked: the five names printed by the script (Blog, Work, Maester, .NET Projects, Agents) were compared against the machine's Profiles UI list — exact match, no extras or missing entries.

### Fact 2 — `useDefaultFlags.extensions: true` = inherits default profile's extensions

Confirmed. Only "Agents" sets `useDefaultFlags.extensions: true`, and it has no `extensions.json` file under its profile folder (script reports `own=none`). The other four named profiles ("Blog", "Work", "Maester", ".NET Projects") omit `extensions` from `useDefaultFlags` (implicitly false) and each has its own `extensions.json`, including one with zero entries (".NET Projects", `own=0` — an empty-but-present array, distinct from "no file").

```text
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

Cross-check: `code --profile "Blog" --list-extensions` returned exactly 32 distinct ids — the **exact, non-overlapping union** of Blog's 11 own `extensions.json` entries and the 21 application-scoped ids (verified programmatically: intersection of the two id sets is empty; 11 + 21 = 32). No dedup case exists in this data: an id appears in a profile's own list or in the app-scoped set, never both. This is consistent with app-scoped extensions being visible in every profile regardless of that profile's own `extensions.json`.

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

### Fact 7 — orphan definition

Not directly exercised this spike (orphan computation is Task 9's scope); nothing observed contradicts the orphan definition.

## Step 2: CLI profile-scoping check (`code --profile "Blog"`)

Ran the exact sequence against the real "Blog" profile:

```text
$ code --profile "Blog" --list-extensions
anthropic.claude-code
bierner.github-markdown-preview
... (32 entries total, no hexeditor)

$ code --profile "Blog" --install-extension ms-vscode.hexeditor
Installing extensions...
Installing extension 'ms-vscode.hexeditor'...
Extension 'ms-vscode.hexeditor' v1.11.1 was successfully installed.

$ code --profile "Blog" --list-extensions
... (33 entries, ms-vscode.hexeditor present)

$ code --list-extensions          # default profile
... (hexeditor NOT present, grep for "hexeditor" returned no match)

$ code --profile "Blog" --uninstall-extension ms-vscode.hexeditor
Uninstalling ms-vscode.hexeditor...
Extension 'ms-vscode.hexeditor' was successfully uninstalled!

$ code --profile "Blog" --list-extensions
... (32 entries, identical to the pre-install list, hexeditor gone)
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

---

# Spike B — apply-to-all-profiles toggle invocability findings

**Machine:** Windows 11, VS Code Stable 1.127.0 (`4fe60c8b1cdac1c4c174f2fb180d0d758272d713`), downloaded fresh into `.vscode-test/` for this spike — not the machine's real install, and never touched it.
**Method:** Interactive F5 debugging is unavailable in this environment, so the brief's Steps 1-2 were replaced with an automated sandbox probe using `@vscode/test-electron`'s `runTests`. Harness lived entirely under `.superpowers/spike-b/` (gitignored, throwaway, not committed): `run.mjs` (launcher: downloads/resolves VS Code stable, creates fresh temp `--user-data-dir`/`--extensions-dir` via `mkdtempSync`, installs `ms-vscode.hexeditor` into that sandbox via the VS Code CLI, then launches the Task 1 stub extension as `extensionDevelopmentPath` with a probe suite as `extensionTestsPath`) and `suite/index.js` (runs inside the sandboxed Extension Development Host: enumerates commands, tries toggle candidates, reads the sandbox's own `extensions.json` after each attempt).
**Date:** 2026-07-03. Two full runs (run 2 added a fourth argument shape for extra rigor); raw evidence preserved at `.superpowers/spike-b/results-run1.json` and `.superpowers/spike-b/results.json` (both gitignored).

## Environment gotcha worth carrying into Task 12 (CI integration tests)

This machine has `ELECTRON_RUN_AS_NODE=1` set globally. That variable forces any Electron binary — including VS Code's `Code.exe` — to run as a bare Node process instead of launching the real Chromium/Electron GUI, which is exactly how VS Code's own `bin/code.cmd` CLI wrapper works internally (it sets that same variable before invoking `Code.exe <path-to-cli.js>`). With it set process-wide, `@vscode/test-electron`'s `runTests()` (which spawns `Code.exe` directly with workbench flags, not through the CLI wrapper) fails immediately: every flag is misparsed as a Node CLI flag (`Code.exe: bad option: --user-data-dir=...`) and `Code.exe --version` prints a bare Node version string instead of VS Code's version banner. Deleting `ELECTRON_RUN_AS_NODE` from `process.env` before calling `runTests()` (done in `run.mjs`) fixed it. Task 12's CI runner should check for this if integration tests mysteriously fail with "bad option" errors.

## Step 1-2: command enumeration

`vscode.commands.getCommands(true)` filtered for `/profile/i` **and** `/extension/i` returned exactly 6 commands (both runs, consistent):

```text
workbench.action.extensionHostProfiler.stop
workbench.extensions.action.extensionHostProfile
workbench.extensions.action.openExtensionHostProfile
workbench.extensions.action.saveExtensionHostProfile
workbench.extensions.action.stopExtensionHostProfile
workbench.extensions.action.toggleApplyToAllProfiles
```

Five of these are the unrelated extension-host **performance profiler** feature (they match the regex because "extensionHostProfile" contains both "extension" and "Profile"). Only the sixth, `workbench.extensions.action.toggleApplyToAllProfiles`, is the real feature. A second, wider filter (`/extension/i` and `/(apply|scope|allprofiles|application)/i`) was run as a cross-check against missing an oddly-named command — it converged on that exact same single command, no others. Total registered commands at enumeration time: 3046 (run 1) / 3042 (run 2) — small run-to-run variance from extension activation timing, not relevant here.

Of the brief's two hypothesized ids, only the "action"-suffixed one actually exists:

- `workbench.extensions.command.toggleApplyToAllProfiles` — **does not exist**. Every attempt (both runs, all argument shapes) failed identically: `Error: command 'workbench.extensions.command.toggleApplyToAllProfiles' not found`.
- `workbench.extensions.action.toggleApplyToAllProfiles` — **exists and is invocable** (no "not found" error) — see below.

## Step 3: argument-shape attempts against the real command

`workbench.extensions.action.toggleApplyToAllProfiles` was tried with four argument shapes against `ms-vscode.hexeditor` (installed fresh into the sandbox for this purpose). All four failed with the identical error, byte-for-byte across both runs:

| Arg shape | Value | Result |
| --- | --- | --- |
| string | `"ms-vscode.hexeditor"` | Threw `TypeError: Cannot read properties of undefined (reading 'location')` |
| object | `{ id: "ms-vscode.hexeditor" }` | Same `TypeError` |
| array | `["ms-vscode.hexeditor"]` | Same `TypeError` |
| public API object | `vscode.extensions.getExtension("ms-vscode.hexeditor")` (the real `vscode.Extension` handle — the most legitimate non-string thing a well-behaved extension could pass) | Same `TypeError` |

Stack trace (identical every time) bottoms out in the command's own handler, not in argument validation:

```text
TypeError: Cannot read properties of undefined (reading 'location')
    at Object.run (...workbench.desktop.main.js:3672:2910)
    at K.run (...workbench.desktop.main.js:3672:7968)
    at handler (...workbench.desktop.main.js:441:38449)
    ...
    at Zrt.executeCommand (...workbench.desktop.main.js:1893:4376)
```

This shape (crash inside the handler body, on every plausible argument including the genuine public `vscode.Extension` object, always on the same `.location` property read) indicates the command's real parameter is VS Code's **internal** `IExtension` workbench view-model (the object the Extensions view UI passes to its own context-menu actions — it carries `.local`/`.server` fields with a nested `.location`), not a string id, a plain object, or the public extension API's `vscode.Extension`. That internal type is not constructible or obtainable through any public `vscode` namespace API. Reverse-engineering its private shape to satisfy the crash was deliberately not attempted: doing so would mean shipping Visex against an unversioned internal VS Code implementation detail with no compatibility guarantee — precisely the situation this spike exists to detect and avoid.

Confirmation the flag never moved: `ms-vscode.hexeditor`'s `metadata.isApplicationScoped` was read from the sandbox's on-disk `extensions.json` after every single attempt (21 attempts in run 1, 28 in run 2, one per candidate-command × arg-shape pair, including the 5 unrelated profiler commands, all included for completeness) and after all of them combined, both runs — it never appeared as `true`. It started and ended `undefined` (absent from `metadata`, the normal state for a freshly-installed extension), matching the launcher's own before/after check via the VS Code CLI-installed manifest.

## Verdict

**`TOGGLE_SUPPORTED: no — fallback UI required`**

The command exists (`workbench.extensions.action.toggleApplyToAllProfiles`), but it is not invocable by a third-party extension with any argument shape available through the public API — string, `{id}`, array, and the genuine `vscode.Extension` object all crash identically inside the handler before reaching any state mutation. No enumerated command (out of 3046/3042 total, cross-checked with two independent regex filters) ever flipped `isApplicationScoped` for the target extension. Per the task's own gating rule, this is not a borderline case requiring judgment — it's a clean, doubly-corroborated "no." Task 10 should ship the guided fallback: open the Extensions view search pinned to the extension so the user can right-click → "Apply Extension to all Profiles" themselves.
