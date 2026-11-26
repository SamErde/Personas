# Home layout polish (#160)

Polish the three Home views (VS Code Profiles, PowerShell Profiles, Git Configuration) in
the Primary Side Bar: give them sensible default sizes, make title bar actions consistent
where VS Code allows it, and replace the cramped PowerShell help.

## Verified constraints (VS Code main `8cfcc55`, 2026-11-26)

- **No runtime sizing.** Extensions cannot set a view's height or make it fit its content.
  `WebviewView` has no size API. Size-to-content (`setSizeToContent`, `getOptimalHeight`,
  min/max body size) is used only by built-in views such as Open Editors.
- **`initialSize`** on a `contributes.views` entry is a flex-like weight (default 20). It is
  honoured only when the extension owns the view container, which Personas does.
  `computeInitialSizes()` splits the container height in proportion to the weights. This
  happens only when no stored size exists.
- **Sizes are saved after every layout**, even if the user never drags a divider. They are
  stored per workspace (`workbench.view.extension.personas.state`). A new `initialSize`
  therefore reaches only workspaces that have not shown Home yet. "Reset View Locations"
  does not reset sizes.
- **When title actions show.** Webview view panes use `ViewPaneShowActions.WhenExpanded`, so
  their actions are visible whenever the view is expanded. Tree view panes use the default, which shows actions only
  on hover or focus. Only the global `workbench.view.alwaysShowHeaderActions` setting
  changes this; there is no per-view option.
- **The `...` overflow** is drawn only when secondary menu items exist, and VS Code adds none
  of its own to a view's title menu. If Open Personas Settings moves to `navigation`, the
  `...` disappears.
- **`viewContainer/title` is not available to Personas.** It is a proposed API and is limited
  to the Debug container, so Home cannot have a single gear on its container.
- **Webview content is clipped to the view.** A `<dialog>` or popover cannot grow past the
  iframe. A modal `showInformationMessage` with `detail` can.

## Decisions (agreed in the grilling session)

| # | Decision |
|---|----------|
| Q1 | Set `initialSize` weights: VS Code Profiles **5**, PowerShell Profiles **3**, Git Configuration **2**. |
| Q2 | Replace the `...` menu with a `$(settings-gear)` **Open Personas Settings** title action at the right end of every Home view. |
| Q3 | Keep VS Code's hover-only title actions on Git Configuration. Document the behaviour and `workbench.view.alwaysShowHeaderActions` in the README. |
| Q4 | Show PowerShell help in a VS Code **modal dialog**, which closes with Esc, Cancel, or an X where the platform draws one. The dialog is noticeably larger mainly with `window.dialogStyle: custom`; native dialogs (the default) have a fixed width and, on macOS, no X. |
| Q5 | The dialog has two buttons: **Open PowerShell Settings** (Settings filtered to the Personas PowerShell settings) and **Profiles on Microsoft Learn**. |
| Q6 | Remove the in-view `<dialog>` and its message plumbing entirely. |

Independent design review: APPROVE WITH CHANGES. All its findings are folded into this plan.

No ADR: every decision is cheap to reverse. No glossary change: no new domain terms.

## Changes

### 1. `package.json`

- `views.personas`: add `"initialSize": 5` / `3` / `2` to `personas.vscodeProfiles` /
  `personas.powerShellProfiles` / `personas.gitConfiguration`.
- `commands`: give `personas.openSettings` the icon `"$(settings-gear)"`. Keep the title
  "Open Personas Settings"; the Command Palette still lists it as
  "Personas: Open Personas Settings".
- `menus.view/title`: move `personas.openSettings` from group `settings` to
  `navigation@9`, so it sits after each view's other actions:
  - VS Code Profiles: gear
  - PowerShell Profiles: refresh, help, gear
  - Git Configuration: show effective, refresh, gear

### 2. PowerShell help as a modal dialog

- New module `src/panel/powerShellHelp.ts` exports `showPowerShellHelp()`:
  - Calls `vscode.window.showInformationMessage('PowerShell Profiles help', { modal: true, detail }, openSettings, learn)`.
  - `detail` holds the three existing Q&As as plain text: each question on its own line, its
    answer on the next line, and a blank line between pairs. The wording is unchanged except
    for dropping the bold.
  - **Open PowerShell Settings** runs `workbench.action.openSettings` with
    `@ext:SamErde.personas powerShellProfiles`. The `@ext` tag limits results to Personas,
    and the remaining text is matched case-insensitively against setting IDs
    (`preferencesSearch.ts:199-206`). Only the two `personas.powerShellProfiles.*` settings
    match. The query is ignored when `workbench.settings.editor` is `json`, as it already is
    for `personas.openSettings`.
    - This is preferred over an `@id:` list: it is an older search path and needs no change
      when a PowerShell setting is added.
  - **Profiles on Microsoft Learn** calls `vscode.env.openExternal` with the existing
    `about_profiles` URL.
  - Dismissing the dialog (`undefined`) does nothing.
- `extension.ts`: `personas.powerShellProfiles.help` calls `showPowerShellHelp()` directly. It
  no longer goes through the view provider and no longer focuses or reveals the view.
- Remove:
  - `PowerShellProfilesViewProvider.help()`, `showRequestedHelp()` and `pendingHelp`.
  - The `ready` field and every assignment to it (its only reader is `showRequestedHelp()`).
    Keep the page's `{type:'ready'}` message and the `onMessage` load path; that path drives
    discovery once per show (#150).
  - The `#ps-help` `<dialog>` markup and its styles in `powerShellProfilesMarkup.ts`.
  - The help wiring in `src/webview/powerShellProfiles.ts`: the dialog lookup, the Close
    handler, the `close` focus listener and the `showPowerShellHelp` branch.
  - `{ type: 'showPowerShellHelp' }` from `HostToPowerShellProfiles` in `protocol.ts`, and
    update the comment on line 138.

### 3. Tests

- Delete the three help tests in `test/unit/powerShellProfilesView.test.ts`: "does not
  replay Help…", "opens section help…" and "cancels pending Help…". Keep the shared Settings
  command test.
- Add `test/unit/powerShellHelp.test.ts`. `sidebarDoubles.ts` has no
  `window.showInformationMessage`, and `commands.executeCommand` records only command IDs.
  Extend the double to record arguments and return a chosen button, or `vi.mock('vscode')`
  in the new test. Match buttons by label, never by position. Cover:
  - the modal call shape (`modal: true`, `detail` contains each question);
  - the settings button opens the filtered settings;
  - the Learn button opens the external URL;
  - dismissing does nothing.
- Add a unit test that checks the `package.json` contributions:
  - the `initialSize` weights;
  - `openSettings` appears in `navigation` for all three views with an icon;
  - the existing actions keep their order (`powerShellProfiles.help` stays `navigation@2`);
  - no Home `view/title` item remains outside `navigation`.
- Integration `inventory.test.ts` already checks that the commands are registered. No change.

### 4. Docs

- README **Home settings**: describe the gear icon instead of the `…` menu. Keep the sentence
  about the container's `…`, because VS Code still shows that one.
- README **PowerShell profiles**: the `?` now opens a help dialog with buttons for
  PowerShell settings and Microsoft Learn.
- README **A sidebar you can arrange** (Features): add one sentence each:
  - Home's default view heights apply the first time a workspace shows it; drag the dividers
    to resize.
  - VS Code shows Git Configuration's title actions on hover; set
    `workbench.view.alwaysShowHeaderActions` to always show them.
- `docs/spikes/findings.md`: append a section "Home view layout (VS Code main 8cfcc55,
  checked 2026-11-26)" with the constraints above, plus two edge cases:
  - A view's weight moves with it. A Home view moved into another container takes its
    weight there.
  - With 5/3/2, Git Configuration hits VS Code's 120px minimum body size in a container
    shorter than about 710px.
- Do not touch `CHANGELOG.md` or version fields; release-please owns them.

## Verification

- `npm run lint`, `npm test`, `npm run build`.
- Manual check in an Extension Development Host:
  - In a **new** workspace, check the 5/3/2 split.
  - Check that each view shows the gear and no `...`.
  - Check that Git Configuration's actions show on hover and always show with the
    `workbench.view.alwaysShowHeaderActions` setting on.
  - Check the help dialog with both `window.dialogStyle` values: line breaks in `detail`,
    Esc/Cancel (and X where shown) close it, and both buttons work.
  - Check that Open PowerShell Settings shows exactly the two PowerShell settings in VS Code
    1.101 or the oldest available build.
  - Run help from the Command Palette while the view is collapsed.
- The PR body must note one behaviour change: Help no longer reveals or focuses the
  PowerShell Profiles view.
- Commit as `feat:` (user-visible). Use the PR title
  `feat: size Home views, add settings gear, show PowerShell help in a dialog (#160)`.
