# Personas: Extension Matrix filters, grouping, and accessibility plan

Drafted 2026-11-15 by Sam Erde with Claude. Sam's working copy of this plan is the Claude Doc at https://claude.ai/artifact/Y39LegrV2nb159do44xKFw.

## Goal

The Extension Matrix shows which extensions are installed in which profile, and it lets a person add or remove an extension in any profile from one place instead of switching profiles to do it. This work keeps that purpose and makes the matrix easier to read, narrow down, and use by keyboard or screen reader. The matrix stays neutral about which profiles should contain which extensions, so nothing in it should imply that profiles ought to match. The work also gives profiles one predictable order in both Home and the matrix, and it simplifies the profile names and buttons in Home.

The work is done when all of the following are true:

1. A screen reader announces each matrix cell with its extension name, profile name, and state.
2. Inherited, applied-to-all, and not-installed cells are visually distinct without relying on a tooltip.
3. A person can narrow the list by category, publisher, and install source, and the filters combine predictably.
4. A person can group the list by name or publisher, with group headings that assistive technology announces.
5. Profiles appear in the same order in the Home profile list and the matrix columns: Default first, then the Agents window profile when it is shown, then every other profile in alphanumeric order.
6. Profile names in Home are plain text, and the pencil icon is the only control beside each name.
7. Home's buttons use VS Code's standard button shape instead of pills, and the Open Extension Matrix button stays under the Profiles & Extensions heading.
8. Each change ships with unit tests for its logic, and the existing integration suite still passes.

## Current state on main

These facts were checked against `main` at `bbd82a6` (release 1.3.0, which includes [PR #116](https://github.com/SamErde/Personas/pull/116) and [PR #118](https://github.com/SamErde/Personas/pull/118)). Items marked ASSERTED were not verified in code.

| Area | What exists today | Location |
| --- | --- | --- |
| View filter | One single-select chip value (`all`, `orphaned`, or `appliedToAllProfiles`) plus a text filter that matches only the ID and display name. | `src/webview/render.ts` (`buildViewModel`), `src/webview/main.ts` toolbar |
| Sort | Rows are always sorted by display name, then ID. | `buildViewModel` |
| Cells | Writable cells are bare checkboxes with no accessible name. The name cell is a `td`, not a row header. | `renderContent` in `main.ts` |
| Cell states | Inherited and applied-to-all cells both render a muted check mark, distinguished only by `title`. An inherited cell that is not installed renders an empty string. | `renderContent` |
| Rendering | Every keystroke and host message tears down and rebuilds the whole table, with listeners attached per row. | `renderContent` |
| Focus | A rebuild drops keyboard focus to the page body. Toggling a checkbox rebuilds the table at once and replaces the checkbox with a pending spinner, so focus is lost on every toggle. Focus is restored only for controls inside the hover card. Pressing Escape inside the hover card hides it without returning focus to the extension name that opened it. | `renderContent`, `syncOpenCard`, `hideCard` in `main.ts` |
| Crosshair | Indexing assumes every row has exactly one cell per column, with no spans. Hit testing treats every `th` as a column header, and row highlighting selects only `td` cells by column index. `style.css` makes every `th` sticky to the top of the table. | `src/webview/crosshair.ts`, `gridHitAt` and `applyCrosshair` in `main.ts`, `src/webview/style.css` |
| Disabled cells | A cell is disabled when any warning names its profile, including duplicate-name warnings, but its tooltip always says the extension list could not be read. An unreadable profile counts as having nothing installed. When Default's list is unreadable, profiles that inherit from Default also show nothing installed, while the warning names only Default. | `disabledProfileIds` in `inventoryQueries.ts`, `composeInventory`, `renderContent` |
| View chips | The view chips are plain buttons whose selection is shown only by a CSS class, so assistive technology cannot tell which view is active. | `updateChipButtons` in `main.ts` |
| Panel state | The matrix panel uses `retainContextWhenHidden`, so its state survives hiding. Closing the panel disposes it, and webview state is lost with it. | `src/panel/matrixPanel.ts` |
| Extension data | `ExtensionRecord` carries `publisher`, `publisherDisplayName`, `description`, and `installedTimestampMs`. It does not carry `categories` or `metadata.source`. Each package field comes from the first readable version folder in directory order, including obsolete folders. Manifest entries are parsed in `parsers.ts`, which keeps each entry's version but drops `relativeLocation`, while a parsed folder name keeps its platform suffix (such as `1.2.3-win32-x64`), so a manifest version does not identify its folder. Workspace-only extensions read their metadata through a separate path. | `src/core/types.ts`, `src/core/inventory.ts`, `src/core/parsers.ts`, `src/core/workspace.ts` |
| Install source | `metadata.source: "gallery"` is confirmed in real manifests. Other values such as `vsix` and `resource` are ASSERTED. | `docs/spikes/findings.md` |
| Profile counts | Home already computes per-profile counts (`direct`, `fromDefault`, `appliedToAllProfiles`). The matrix headers do not show counts. | `src/protocol.ts` (`HomeProfileVm`) |
| Profile order | Default comes first, and every other profile follows in VS Code's unsorted registry order. Home and the matrix both use this order. | `composeInventory` in `src/core/inventory.ts` |
| Home buttons | The base `button` style in Home gives every button a pill shape (`border-radius: 1rem`) with a high-contrast border from [PR #118](https://github.com/SamErde/Personas/pull/118). Open Extension Matrix, under the Profiles & Extensions heading, is the only button that still shows the pill, because the workspace card and PowerShell buttons override it. The workspace card is one card-wide button with 3px top corners, and its Open manifest and Edit manifest buttons are styled as text links. | `src/panel/homeView.ts` styles, `src/webview/home.ts` |
| Home profile names | For a profile with its own extensions, the name is a link that opens its `extensions.json` read-only, and a pencil (an `a` element with `role="button"`) opens the raw file for editing with a caution. A profile that inherits Default's extensions shows a plain-text name and no pencil. | `src/webview/home.ts`, `src/panel/homeView.ts` |
| Tests | `render.test.ts` covers the view model, `inventory.test.ts` covers parsing, and `crosshair.test.ts` covers the pure crosshair logic with pre-classified hits. No test renders the matrix DOM. `powershellRender.test.ts` already renders Home markup under jsdom, which is a pattern the matrix can follow. | `test/unit/` |

## Scope and non-goals

Everything in scope uses data already on disk, so the matrix stays offline and read-only toward VS Code state files.

In scope:

- Accessible names and row headers for matrix cells, plus distinct visuals for each cell state.
- Filters for category, publisher, and install source, read from `package.json` and the manifests.
- Group by name or publisher.
- Search that also matches the publisher.
- One shared profile order for Home and the matrix.
- Plain-text profile names in Home.
- VS Code's standard button shape for Home's buttons, including a check of the workspace card buttons.

Out of scope:

- Any marketplace query (install counts, ratings, or tags fetched online).
- Keyword, tag, or language chips, which were rejected earlier as too noisy or too incomplete.
- Group by category, because an extension with several categories would appear in several groups and duplicate its checkboxes.
- Views that compare profiles (such as "Differs between profiles" or "Missing from a chosen profile"), because they imply that profiles should match and the matrix should stay neutral.
- Per-profile counts in the column headers, because Home already shows them and they don't help with filtering.
- Other changes to Home, the PowerShell profiles feature, or the orphan cleanup view.

## Delivery plan

The work ships as seven small PRs, with accessibility first because every later PR builds on the same table markup. Each branch starts from a freshly synced `main`.

| PR | Change | Main files | Depends on |
| --- | --- | --- | --- |
| 1. Accessible cells | Make the name cell a `th scope="row"`, and update the crosshair and sticky-header styles so they tell column headers, row headers, and cells apart. Give each checkbox a stable accessible name ("PowerShell in Work") with its native checked state, and give every non-checkbox cell an `aria-label` naming its state. Separate whether an install is known from whether a cell can act, and give each disabled cell its real reason. Give inherited, applied-to-all, not-installed, and unknown cells distinct glyphs, and add a short legend. Move the table renderer where a jsdom test can call it. | `main.ts`, `style.css`, `render.ts`, a new matrix DOM test | None |
| 1b. Focus restoration | Preserve keyboard focus across table rebuilds, including while a toggled cell is pending, and return focus to the extension name when Escape closes the hover card. | `main.ts`, the matrix DOM test | 1 |
| 2. Extension data | Keep each manifest entry's folder reference, and add `categories` from that folder's `package.json` and an install source from `metadata.source` to `ExtensionRecord`, with parser and composition tests. | `types.ts`, `parsers.ts`, `inventory.ts`, `parsers.test.ts`, `inventory.test.ts` | None |
| 3. Filter model | Replace the single `chip` value with a filter state that has separate dimensions, and expose the selected view to assistive technology. Add publisher search, a debounce on the text filter, an announced result count, and session persistence for the view state. | `render.ts`, `main.ts`, `matrixPanel.ts`, `protocol.ts`, `render.test.ts` | 1 |
| 4. Category, publisher, and source filters | Add the three filter controls and the row of active-filter chips. | `main.ts`, `style.css`, `render.ts` | 2 and 3 |
| 5. Group by | Add a Group by control (None, Name, or Publisher) that renders a `tbody` per group with a heading row. Update the crosshair to skip heading rows, and keep the hover card's row index in step with the grouped order. | `main.ts`, `render.ts`, `crosshair.ts`, `crosshair.test.ts`, the matrix DOM test | 1 and 3 |
| 6. Profile order, Home names, and Home buttons | Sort profiles once in `composeInventory` so Home and the matrix share one order. Make Home profile names plain text, and make the pencil a native `button` instead of an `a` element with `role="button"`. Keep Open Extension Matrix under the section heading, restyle Home's buttons to VS Code's standard shape, and check the workspace card buttons against the same style. | `inventory.ts`, `home.ts`, `homeView.ts`, `inventory.test.ts` | None |

PRs 1, 2, and 6 can proceed in parallel, and PR 6 can ship first. PR 1b can proceed in parallel with PRs 3 to 5 once PR 1 merges. If any PR uncovers a larger problem, it pauses and the plan is updated before work continues.

## Design decisions

These decisions are directional. Details that depend on testing are left to the PR that implements them.

**Filter semantics.** Values within one dimension combine with "or," and dimensions combine with "and." The view chips (All, Orphaned, and Applied to all profiles) stay single-select, because each one is a different lens rather than an attribute. Filter logic stays in pure functions so it can be unit-tested without a DOM.

**Filter controls.** Category, Publisher, and Source each open a group of native checkboxes from a disclosure button rather than an ARIA menu, so the controls need no custom keyboard model. A count beside each value shows how many rows match it under the other active filters, without promising the total after a click. A long publisher list gets its own search box. Active filters appear as removable, clearly named chips with a way to clear them all. If the three buttons do not fit the toolbar, a single Filters disclosure holding all three groups is the fallback.

**View chips.** The view chips expose which one is selected to assistive technology, not only through color.

**Categories.** Categories come from the folder that a profile manifest actually points to, because the manifest version alone cannot identify a platform-specific folder. PR 2 settles the fallback for a missing reference, which should avoid obsolete folders. A row without categories, including a workspace-only row, falls under Unknown.

**Install source.** The record keeps every distinct install source across profiles, because one extension can be installed from the Marketplace in one profile and from a VSIX in another. A row matches the filter when any of its sources matches. Sources without a known label, or without a value, fall under Other or Unknown.

**Publisher.** Publishers are matched by ID and labelled with their display name when one is available. Rows without publisher data fall under Unknown.

**Group by.** Each group gets a heading row that assistive technology announces as a group heading and that shows the group's count. Name groups run A to Z, with a final group for names that do not start with a Latin letter, so every row lands in exactly one group. Groups are not collapsible in the first version, which keeps the focus model simple.

**Cell states.** The view model separates what is known about an install (installed, not installed, or unknown because a list could not be read) from whether the cell can act and why not. Profiles that inherit from an unreadable Default are unknown too. Each state is distinct by shape, not only color, has its own screen reader text, and appears in the legend. The states must stay legible in high-contrast themes.

**Focus.** PR 1b owns this decision. A rebuild keeps keyboard focus on the same logical control, including a cell while its change is pending and after it completes. Focus moves to a nearby control only when its control is actually removed, and a rebuild never takes focus from outside the matrix. Pressing Escape in the hover card returns focus to the extension name that owns it.

**State persistence.** The view, filters, and grouping survive hiding the panel, which `retainContextWhenHidden` already provides. To also survive closing and reopening the panel, the extension host keeps them in memory for the session and sends them to the new panel, because webview state is destroyed with its panel. They are not saved across VS Code restarts.

**Performance.** The text filter gets a short debounce, and per-row listener setup should shrink where that is easy. Any deeper change to the full-table rebuild waits for a measurement with at least 300 extensions and 6 profiles.

**Profile order.** Default comes first and the Agents window profile second, followed by every other profile in a case-insensitive natural sort, so "Profile 2" comes before "Profile 10". The Agents window column sits beside Default because its cells mirror Default's. Moving it to the end of the matrix is the recorded fallback if that placement reads poorly.

**Home profile names.** Removing the name link also removes the read-only view of a profile's `extensions.json`, because only the link offers it. Sam accepted that loss on 2026-11-15, so PR 6 is not blocked.

**Home buttons.** Home's buttons take VS Code's standard shape, with a 2px corner radius and full width up to a maximum, instead of pills. The maximum should match the buttons VS Code shows in its own views, which PR 6 confirms rather than guesses. The high-contrast border from PR #118 stays. The workspace card buttons get checked at the same time, and PR 6 decides whether the manifest actions stay as text links or become standard buttons, so that the card reads as one consistent control group.

**Announcements.** A polite live region announces the result count ("42 of 180 extensions") after each filter change.

## Verification plan

Each PR must pass `npm run lint`, `npm test`, and `npm run test:integration` before review, plus the checks below.

| Check | How | PRs |
| --- | --- | --- |
| Filter logic | Unit tests in `render.test.ts` for each view, each filter dimension, the and/or combination, inheriting profiles, unreadable profiles, and workspace-only rows. | 3, 4 |
| Parsing | Unit tests in `parsers.test.ts` and `inventory.test.ts` for missing or malformed `categories`, missing `metadata`, an extension with different sources in two profiles, conflicting categories across current and obsolete version folders, a platform-suffixed folder, several folders that share one version, and a manifest entry without a folder reference. | 2 |
| Matrix DOM | jsdom tests, following `powershellRender.test.ts`, for row-header classification in the crosshair, accessible names and checked states, filter-chip removal, and grouped row indexing. These tests do not replace the NVDA and theme checks. | 1, 3, 4, 5 |
| Focus | jsdom tests for focus through a toggle from pending to complete, an unrelated refresh, removal of the focused row, and Escape from the hover card. | 1b |
| Profile order | Unit tests in `inventory.test.ts` for Default first, the Agents window profile second, natural number order, mixed case, and the Agents window setting turned off, plus a manual check that the Home list and the matrix columns match. | 6 |
| Grouping and crosshair | Unit tests for group order, the "#" group, accented and non-Latin names, every row appearing exactly once, and crosshair indexing that skips heading rows. | 5 |
| Screen reader | A manual pass with NVDA on Windows that checks cell names, row headers, group headings, filter group focus, the result announcement, and the Home pencil button. | 1, 1b, 3, 4, 5, 6 |
| Keyboard | Every control is reachable by Tab, and filter groups and the Home pencil button open with Enter or Space. Toggling a checkbox keeps focus on that cell while it is pending and after it completes, and Escape from the hover card returns focus to the extension name. | 1b, 3, 4, 5, 6 |
| Themes | Light, dark, and both high-contrast themes, checking glyphs, chips, and focus rings. | 1, 4, 5 |
| Home buttons | In all four themes and at a narrow and a wide sidebar width, check that Home's buttons have the standard shape, stop growing at the maximum width, keep their high-contrast border, and look consistent with the workspace card buttons. | 6 |
| Panel state | Hide and reveal the panel, then close and reopen it, and confirm that the view, filters, and grouping return both times. | 3 |
| Performance | Time a full render with a fixture of 300 extensions and 6 profiles before and after PR 3. | 3 |

## Uncertainty log

These are the assumptions most likely to be wrong, with what would settle each one.

| Assumption | Risk if wrong | How to settle it |
| --- | --- | --- |
| `metadata.source` uses `vsix` and `resource` besides `gallery`. | The Source filter mislabels or hides some extensions. | Sideload a VSIX into a test profile and read its manifest entry. |
| Three filter buttons fit in the toolbar beside the view chips at a typical panel width. | The toolbar wraps into a cluttered second row. | Prototype the toolbar at 600px and 1,000px widths, and use the single Filters disclosure if it wraps. |
| A `th scope="rowgroup"` heading row announces correctly in NVDA inside a sticky-header table. | Group headings are silent or announced as data. | Test the markup in NVDA before building PR 5. |
| The full-table rebuild is fast enough at 300 extensions. | Typing in the filter box lags. | Measure as described in the verification plan. |
| Faceted counts (counts that reflect other filters) are worth their complexity. | The filter groups are harder to build and test than plain totals. | Decide during PR 4 after seeing real data. |

## Adversarial review brief

The reviewer's job is to find what is wrong with this plan, not to approve it. Read the plan against `main` in [SamErde/Personas](https://github.com/SamErde/Personas), starting with `src/webview/render.ts`, `src/webview/main.ts`, `src/webview/crosshair.ts`, `src/core/inventory.ts`, `src/webview/home.ts`, and `docs/spikes/findings.md`.

Challenge the plan on these four axes:

1. **Assumptions.** Which facts are wrong or unverified? Does the goal match what a person managing VS Code profiles actually needs? Is anything in scope that should not be, or missing that should be?
2. **Accessibility.** Will the table, menus, chips, group headings, and live region work with NVDA and in high-contrast themes? Where will focus get lost during a rebuild?
3. **UI patterns.** Is this the simplest UI that meets the goal? Would a different pattern (such as a single filter panel, column-header actions, or fewer controls) serve better?
4. **Code quality.** Does the PR split keep each change small and reviewable? Are the boundaries between the view model, the renderer, and the host clean? What will be hard to test or maintain?

Report each finding with a severity (blocking, important, or minor), the evidence (file and line, or the plan section), and a concrete alternative. Label each claim VERIFIED if you checked it in code during the review, or ASSERTED otherwise. End with a verdict: ready to implement, ready after named changes, or not ready.

## Review log

Each review round adds a row here, and the plan sections above are revised in place. Implementation starts when a round ends with a "ready to implement" verdict.

| Round | Reviewer | Verdict | Changes made |
| --- | --- | --- | --- |
| 1 | gpt-6-astra (Codex CLI, high reasoning) | Ready after named changes | Accepted all ten findings after checking them in code. Added focus preservation, crosshair and sticky-header fixes, a cell knowledge model, and a matrix DOM test harness to PR 1. Replaced filter menus with disclosure buttons over native checkboxes, kept a single Filters panel as the fallback, exposed the selected view chip, and corrected the faceted-count promise. Moved session persistence to the extension host. Named `parsers.ts` and category provenance in PR 2, and made name grouping total. |
| 2 | gpt-6-astra (Codex CLI, high reasoning, resumed session) | Ready after named changes | Confirmed eight round 1 findings resolved and accepted all three new or remaining findings after checking them in code. Made pending-cell focus one contract that keeps focus on the cell, added hover card Escape to the focus contract, and had PR 2 keep each manifest entry's folder reference so categories come from the right platform folder. |
| 3 | gpt-6-astra (Codex CLI, high reasoning, resumed session) | Ready to implement | Confirmed all three round 2 findings resolved and raised no new findings. No plan changes were needed. |
| After 3 | Sam Erde | Not a review round | Split focus restoration and the hover card Escape fix out of PR 1 into PR 1b, trimmed the design decisions back to directional guidance, and accepted losing the read-only `extensions.json` view in Home, which unblocks PR 6. |
| After 3 | Sam Erde | Not a review round | Added Home's button shape to PR 6: Open Extension Matrix stays under the section heading, Home's buttons change from pills to VS Code's standard shape, and the workspace card buttons get checked at the same time. |