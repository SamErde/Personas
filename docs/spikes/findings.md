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

This shape (crash inside the handler body, on every plausible argument including the genuine public `vscode.Extension` object, always on the same `.location` property read) indicates the command's real parameter is VS Code's **internal** `IExtension` workbench view-model (the object the Extensions view UI passes to its own context-menu actions — it carries `.local`/`.server` fields with a nested `.location`), not a string id, a plain object, or the public extension API's `vscode.Extension`. That internal type is not constructible or obtainable through any public `vscode` namespace API. Reverse-engineering its private shape to satisfy the crash was deliberately not attempted: doing so would mean shipping Personas against an unversioned internal VS Code implementation detail with no compatibility guarantee — precisely the situation this spike exists to detect and avoid.

Confirmation the flag never moved: `ms-vscode.hexeditor`'s `metadata.isApplicationScoped` was read from the sandbox's on-disk `extensions.json` after every single attempt (21 attempts in run 1, 28 in run 2, one per candidate-command × arg-shape pair, including the 5 unrelated profiler commands, all included for completeness) and after all of them combined, both runs — it never appeared as `true`. It started and ended `undefined` (absent from `metadata`, the normal state for a freshly-installed extension), matching the launcher's own before/after check via the VS Code CLI-installed manifest.

## Verdict

**`TOGGLE_SUPPORTED: no — fallback UI required`**

The command exists (`workbench.extensions.action.toggleApplyToAllProfiles`), but it is not invocable by a third-party extension with any argument shape available through the public API — string, `{id}`, array, and the genuine `vscode.Extension` object all crash identically inside the handler before reaching any state mutation. No enumerated command (out of 3046/3042 total, cross-checked with two independent regex filters) ever flipped `isApplicationScoped` for the target extension. Per the task's own gating rule, this is not a borderline case requiring judgment — it's a clean, doubly-corroborated "no." Task 10 should ship the guided fallback: open the Extensions view search pinned to the extension so the user can right-click → "Apply Extension to all Profiles" themselves.

---

# Spike C — portable mode / custom `--user-data-dir` CLI behavior findings

**Machine:** Windows 11, VS Code Stable 1.127.0 (`4fe60c8b1cdac1c4c174f2fb180d0d758272d713`), running during the spike — same machine/version as Spikes A and B; the real install was otherwise idle throughout.
**Method:** Per controller adjustment, the brief's manual "create a profile via the Profiles UI, install an extension via the Extensions view" step was replaced with a fully scripted, automated sandbox: two fresh temp dirs (`%TEMP%\personas-spikec-data`, `%TEMP%\personas-spikec-ext`) plus a throwaway workspace folder (`%TEMP%\personas-spikec-workspace`), driven entirely via the `code` CLI and PowerShell process management — no interactive UI clicking. A re-review follow-up added two more short-lived temp dirs for the partial-arg checks in Step 4 (read-only, windowless, deleted after). Full raw command transcript (every command, full output, process lists) is in `.superpowers/sdd/task-4-report.md` (gitignored, not committed); this section summarizes the evidence and verdicts.
**Date:** 2026-07-03.
**Scope note:** This exercises explicit `--user-data-dir`/`--extensions-dir` CLI flags, not literal VS Code "Portable Mode" (a `data\` folder dropped next to `Code.exe`). Per the original brief's own reasoning, this still covers true portable-mode installs: Personas always derives both paths from its own runtime context (`globalStorageUri`, etc.) and passes them explicitly to the CLI (Task 8's `CliRunner`), so a portable install and an explicit-flag invocation are indistinguishable from the CLI's point of view — same two flags, same code path either way.

## Verdicts at a glance

- **(a) Same schemas under custom dirs?** Yes — confirmed, no differences from Spike A Facts 1-6.
- **(b) Does the CLI require both explicit args, with no fallback warning?** Yes — confirmed. Omitting both silently targets the real default install; omitting exactly one silently produces a **hybrid** — only the missing flag's half falls back to its real platform-default path. No warning or error in any omission case.
- **Headless (no-window) named-profile creation possible?** No — a profile is only created as a side effect of opening a real workbench window scoped to that name; every pure data-operation flag refuses a not-yet-created name outright.

## Step 1: sandbox launch

```
$dataDir = "$env:TEMP\personas-spikec-data"; $extDir = "$env:TEMP\personas-spikec-ext"; $wsDir = "$env:TEMP\personas-spikec-workspace"
code --user-data-dir "$dataDir" --extensions-dir "$extDir" --new-window "$wsDir"
```

`<dataDir>\User\globalStorage\storage.json` (plus `state.vscdb`, `vscode.git`) existed on the very first poll (0s wait) — VS Code's first-run user-data layout write-out is effectively synchronous from the CLI dispatcher's point of view, no meaningful startup race to guard against. `Get-CimInstance Win32_Process -Filter "Name='Code.exe'"` filtered on `CommandLine -like "*personas-spikec-data*"` showed 8 processes (main + crashpad-handler + gpu-process + renderer + 4 utility/node-service helpers — the normal multi-process Electron model), all correctly scoped to the sandbox path, none overlapping the real install's 19 pre-existing `Code.exe` processes recorded as a baseline beforehand.

## Step 2 / fact (a): schema verification under custom dirs

Ran `node scripts/spike-formats.mjs "<dataDir>" "<extDir>"` twice: immediately after launch (no named profile yet) and again after Step 3 created `SpikeTest` and installed `ms-vscode.hexeditor` into it.

Immediately after launch — only the implicit default profile exists, exactly like a freshly installed real VS Code:
```
--- userDataProfiles ---
[]
```

After Step 3:
```
--- userDataProfiles ---
[
  {
    "location": "384de42c",
    "name": "SpikeTest"
  }
]
--- global manifest: 0 entries; 1 folders on disk ---
appScoped: []
profile "SpikeTest" (384de42c) inheritsExtensions=false own=1
.obsolete: (absent)
```

Every shape matches Spike A's Facts 1-6 exactly; only the root paths differ (sandbox dirs instead of `%APPDATA%\Code` / `~/.vscode/extensions`):

- **Fact 1** (`userDataProfiles` schema): the vivified entry is `{location, name}` — a subset of the real install's richer entries (which also carry `icon`/`useDefaultFlags` when created via the full "New Profile" dialog with options). Consistent with Spike A's own note that `icon` is optional and can be absent (there: the built-in "Agents" profile); this is simply another instance of that same optionality, not a schema difference.
- **Fact 2** (`useDefaultFlags.extensions` inheritance signal): `SpikeTest` has no `useDefaultFlags` at all (implicit non-inheriting default) and its own `extensions.json` with 1 entry — `own=1`, the same three-state model (own-N / own-0 / own-none via inherits) Spike A documented.
- **Fact 3** (per-profile `extensions.json` entry schema) — trimmed real content of `<dataDir>\User\profiles\384de42c\extensions.json` (full untrimmed entry also carries `location._sep`/`location.external` and a few more `metadata` id/platform fields, omitted here as noise, exactly as Spike A trimmed its own Fact 3 example):
  ```json
  [{
    "identifier": { "id": "ms-vscode.hexeditor" },
    "version": "1.11.1",
    "location": {
      "$mid": 1,
      "fsPath": "c:\\Users\\SamErde\\AppData\\Local\\Temp\\personas-spikec-ext\\ms-vscode.hexeditor-1.11.1",
      "path": "/c:/Users/SamErde/AppData/Local/Temp/personas-spikec-ext/ms-vscode.hexeditor-1.11.1",
      "scheme": "file"
    },
    "relativeLocation": "ms-vscode.hexeditor-1.11.1",
    "metadata": { "installedTimestamp": 1783096827011, "source": "gallery", "publisherDisplayName": "Microsoft", "isPreReleaseVersion": false }
  }]
  ```
  Field-for-field identical to Spike A Fact 3's real-install example (`identifier.id`, `version`, `location.$mid/path/scheme`, `relativeLocation`, `metadata.installedTimestamp`/`source`) — only the path *values* point under the sandbox extensions dir instead of `~/.vscode/extensions`.
- **Fact 4/5** (global manifest = default profile's list; app-scoped flag): global manifest at `<extDir>\extensions.json` is `[]` — correct array shape, empty because nothing was installed into the sandbox's own default profile (everything went into the named `SpikeTest` profile instead). Shape is what's being confirmed; an empty array is a valid instance of the same schema, not a different one.
- **Fact 6** (extension pool + `.obsolete`): `ms-vscode.hexeditor-1.11.1` folder present directly under `<extDir>`, matching the `<publisher.name>-<version>` convention exactly. `.obsolete` is absent (no uninstall happened this spike) — consistent with Spike A's documented "absent is a valid state."

**Verdict (a): CONFIRMED.** Every state-file schema documented in Spike A (Facts 1-6) reproduces identically under custom `--user-data-dir`/`--extensions-dir`. No new fields, no missing required fields, no different empty/absent representations — only the filesystem roots move. Task 6's parsers need zero special-casing for custom-dir installs.

## Step 3: headless named-profile creation attempt (Task 12 question)

Per the controller adjustment, tried its exact command (`--install-extension`; the original brief's own literal example was the read-side `--profile "SpikeTest" --list-extensions`, exercised just below) against a profile name that did not exist yet (no prior UI/window step for it):

```
$ code --user-data-dir "<dataDir>" --extensions-dir "<extDir>" --profile "SpikeTest" --install-extension ms-vscode.hexeditor
Profile 'SpikeTest' not found.
exit=1
```

Same refusal on the read path, to rule out this being install-specific:
```
$ code --user-data-dir "<dataDir>" --extensions-dir "<extDir>" --profile "SpikeTest" --list-extensions
Profile 'SpikeTest' not found.
exit=1
```

Neither call created a profile entry, a profile folder, or installed anything — `scripts/spike-formats.mjs` still showed `userDataProfiles: []` after both attempts. The CLI's data-operation flags never auto-create a named profile.

Surprise, not anticipated by either brief: opening an actual **window** against the same not-yet-existing name does create it:
```
$ code --user-data-dir "<dataDir>" --extensions-dir "<extDir>" --profile "SpikeTest" --new-window
```
After this, `storage.json`'s `userDataProfiles` gained `{"location":"384de42c","name":"SpikeTest"}` — the profile now exists. Retrying the original install command against the now-real profile succeeds cleanly:
```
$ code --user-data-dir "<dataDir>" --extensions-dir "<extDir>" --profile "SpikeTest" --install-extension ms-vscode.hexeditor
Installing extensions...
Installing extension 'ms-vscode.hexeditor'...
Extension 'ms-vscode.hexeditor' v1.11.1 was successfully installed.
exit=0
```

**Verdict (headless creation, for Task 12): NO — there is no headless/no-window profile-creation path.** A named profile is only vivified as a side effect of opening a real workbench **window** scoped to that profile name (either through the Profiles UI, as the original brief assumed, or equivalently — and just as non-headless — via `--profile <newName> --new-window`, which still opens a real GUI window; there is no dedicated profile-creation CLI verb). Pure data-operation flags (`--install-extension`, `--list-extensions`, and by the same logic `--uninstall-extension`) refuse outright with `Profile '<name>' not found.` (exit 1) against a name that hasn't been window-vivified yet, with no auto-create fallback. This confirms Task 12's existing assumption — CI/headless test fixtures must stick to the default profile — and sharpens it: even a one-shot CLI trick can't manufacture a named-profile fixture without flashing a real window, so that door is fully closed for headless CI, not merely impractical.

## Step 4 / fact (b): CLI targeting — explicit args vs. silent fallback

Three-way comparison, run back to back:

| Call | Dir args | `--profile` | Result | Interpretation |
| --- | --- | --- | --- | --- |
| `code --user-data-dir <d> --extensions-dir <e> --profile "SpikeTest" --list-extensions` | both | SpikeTest | `ms-vscode.hexeditor` (1 entry) | targets sandbox's named profile |
| `code --user-data-dir <d> --extensions-dir <e> --list-extensions` | both | none | *(empty)* | targets sandbox's own default profile |
| `code --list-extensions` | **none** | none | 42 entries (`anthropic.claude-code`, `davidanson.vscode-markdownlint`, … full real list) | targets the **real** default install |

Row 3's output is identical (`diff` of the two captured listings, zero differences) to a `code --list-extensions` capture taken *before* the sandbox was ever launched. `node scripts/spike-formats.mjs` (no args → platform defaults) run before, during, and after the entire spike produced identical output all three times — a field-level comparison of the profile registry, global extension manifest, and `.obsolete` (everything the script prints). No warning, no error, no degraded/partial mode when both dir args are omitted — the CLI simply falls back to its normal platform-default paths and operates on the real install as if the sandbox never existed.

### Partial omission (exactly one flag) — a silent hybrid, not a clean fallback

Follow-up prompted by re-review: the rows above only cover both-args and no-args, but the likelier real-world Task 8 bug is dropping *one* of the two flags. Both partial cases were tested explicitly — read-only (`--list-extensions` only, no write ops) and headless (pure CLI data ops, no window) — each against a fresh empty temp dir, with a `--profile "Blog"` probe per case to pin down which half (profile registry vs. extensions pool) the invocation was actually reading. ("Blog" exists only in the real install's registry: own=11, visible=32, per Spike A.)

| Call (all read-only) | Result | Which half fell back to the real install |
| --- | --- | --- |
| `code --user-data-dir <freshTemp1> --list-extensions` | the real default profile's full 42-entry list, identical to the pre-spike baseline capture | **extensions pool** = real; profile-registry half = the temp dir |
| `code --user-data-dir <freshTemp1> --profile "Blog" --list-extensions` | `Profile 'Blog' not found.` (exit 1) | confirms the registry half really was the fresh temp dir, not the real one |
| `code --extensions-dir <freshTemp2> --list-extensions` | empty list (exit 0) | **profile registry** = real; extensions-pool half = the empty temp dir |
| `code --extensions-dir <freshTemp2> --profile "Blog" --list-extensions` | exactly Blog's 11 own entries (exit 0) — not the 32 it lists with no dir args at all | confirms the registry half really was the real one, resolved against the temp pool |

The fourth row is the sharpest demonstration that partial omission is a **hybrid**, not a fallback: Blog's 11 own entries came from the real user-data dir (per-profile `extensions.json` lives there), while the 21 application-scoped extensions vanished from the listing because the app-scoped set lives in the global manifest *inside the extensions dir*, which pointed at the empty temp. The result — 11 instead of 32, exit 0 — is a plausible-looking, silently wrong answer sourced half from each install.

So each flag independently overrides only its own half; every omitted flag's half silently falls back to its real platform-default path; and the CLI never warns or cross-checks that the two halves belong to the same install. Also observed (harmless here, but worth knowing): even these read-only listings scaffold state under the supplied dirs — a supplied `--user-data-dir` gained `logs/<timestamp>/cli.log` (one per invocation), a `machineid` file, and an empty `User/` folder; a supplied `--extensions-dir` gained an empty `extensions.json` (`[]`).

**Verdict (b), stated concretely for Task 8: CONFIRMED, and sharpened.** `code`'s targeting is determined flag-by-flag on each specific invocation — there is no session/env-var affinity to a previously-launched sandbox window, and no error signal if either flag is dropped. Omit both and every operation silently targets the user's real default install; omit exactly one and the operation runs against a silent hybrid of the two installs — the nastier failure mode, because results can look half-right (a real 42-entry list under a sandbox registry; a real named profile listing 11 of its 32 visible extensions). Task 8's `CliRunner` **must** pass both flags together on every single CLI invocation it makes (list/install/uninstall/anything else), sourced from Personas's own runtime paths (its `globalStorageUri`-derived userData root and the sibling extensions root) — never omit either one "just this once," because the failure mode isn't a crash, it's silently reading or mutating the user's real, possibly-production state in whole or in half. `extraArgs` should be treated as a mandatory, inseparable pair on every call site — not optional, and never passed piecemeal.

## Cleanup and isolation confirmation

- All `Code.exe` processes were enumerated via `Get-CimInstance Win32_Process -Filter "Name='Code.exe'"` and filtered to `CommandLine -like "*personas-spikec-data*"` before any kill — 11 matched (two windows' worth of main+helper processes by that point), 0 overlap with the 19 real-install PIDs recorded as a pre-spike baseline. All 11 were stopped (`Stop-Process -Force`, matched by PID from that same filtered list only); a post-kill re-scan found 0 sandbox-tagged processes remaining, and all 19 original real PIDs (plus one unrelated new one — normal churn in a long-running IDE, confirmed to not reference the sandbox path) still running untouched.
- Both temp dirs and the throwaway workspace folder were deleted (`Remove-Item -Recurse -Force`) and confirmed absent afterward. The follow-up partial-omission checks used two additional fresh temp dirs (`personas-spikec-partial-data`, `personas-spikec-partial-ext`), spawned no window or lingering process (pure CLI data ops), and were likewise deleted afterward, with the real install re-verified once more.
- Real install untouched at every level checked — field-level comparison of the profile registry, extension manifests, and CLI listings (`diff` of the captured outputs, zero differences each time): (1) `node scripts/spike-formats.mjs` (platform defaults) captured before the spike vs. during vs. after the main sandbox vs. after the partial-omission checks — identical profile list, global manifest, and `.obsolete` every time; (2) `code --list-extensions` (42 entries) captured before vs. during vs. after — identical; (3) no sandbox-tagged process ever appeared outside the temp-dir-matched filter and no real PID was ever targeted by a kill command. (Incidental real-install state outside the script's output — e.g. window-layout fields the user's own running VS Code rewrites continuously anyway — was not compared; the untouched claim is scoped to the profile/extension state Personas cares about.)

## Surprises / notes for later tasks

- The window-open-vivifies-but-data-ops-refuse asymmetry (Step 3) was not anticipated by either brief and should be folded into Task 12's design notes verbatim — it upgrades "we didn't try headless profile creation" to "we tried the exact headless op, it explicitly refuses every time, and the only thing that works requires a real window."
- Partial flag omission is a silent hybrid, not a clean fallback (Step 4 follow-up): each flag overrides only its own half of the state. Concretely, `--user-data-dir` alone still lists the real install's 42 extensions, and `--extensions-dir` alone lists a real named profile at 11 of its 32 visible extensions (the app-scoped union half lives in the extensions dir's global manifest). This is the strongest single argument for Task 8 treating the two `extraArgs` as an inseparable pair rather than two independent options.
- `storage.json`/`state.vscdb` appeared before the first poll fired (effectively immediate on this machine) — nothing for Task 12 to guard against there.
- A cosmetic Node `DEP0169` deprecation warning (`url.parse()`) appeared on stderr during the second `--install-extension` call — harmless noise from the CLI's bundled Node runtime, unrelated to Personas, not worth guarding against.
