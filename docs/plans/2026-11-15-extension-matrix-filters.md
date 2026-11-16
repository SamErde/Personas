# Personas: Extension Matrix filters, grouping, and accessibility plan

Drafted 2026-11-15 by Sam Erde with Claude. Sam's working copy of this plan is the Claude Doc at https://claude.ai/artifact/Y39LegrV2nb159do44xKFw.

## Goal

The Extension Matrix shows which extensions are installed in which profile, and it lets a person add or remove an extension in any profile from one place instead of switching profiles to do it. This work keeps that purpose and makes the matrix easier to read, narrow down, and use by keyboard or screen reader. The matrix stays neutral about which profiles should contain which extensions, so nothing in it should imply that profiles ought to match. The work also gives profiles one predictable order in both Home and the matrix, and it simplifies the profile names in Home.

The work is done when all of the following are true:

1. A screen reader announces each matrix cell with its extension name, profile name, and state.
2. Inherited, applied-to-all, and not-installed cells are visually distinct without relying on a tooltip.
3. A person can narrow the list by category, publisher, and install source, and the filters combine predictably.
4. A person can group the list by name or publisher, with group headings that assistive technology announces.
5. Profiles appear in the same order in the Home profile list and the matrix columns: Default first, then the Agents window profile when it is shown, then every other profile in alphanumeric order.
6. Profile names in Home are plain text, and the pencil icon is the only control beside each name.
7. Each change ships with unit tests for its logic, and the existing integration suite still passes.

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

Out of scope:

- Any marketplace query (install counts, ratings, or tags fetched online).
- Keyword, tag, or language chips, which were rejected earlier as too noisy or too incomplete.
- Group by category, because an extension with several categories would appear in several groups and duplicate its checkboxes.
- Views that compare profiles (such as "Differs between profiles" or "Missing from a chosen profile"), because they imply that profiles should match and the matrix should stay neutral.
- Per-profile counts in the column headers, because Home already shows them and they don't help with filtering.
- Other changes to Home, the PowerShell profiles feature, or the orphan cleanup view.

## Delivery plan

The work ships as six small PRs, with accessibility first because every later PR builds on the same table markup. Each branch starts from a freshly synced `main`.

| PR | Change | Main files | Depends on |
| --- | --- | --- | --- |
| 1. Accessible cells | Make the name cell a `th scope="row"`, and update the crosshair and sticky-header styles so they tell column headers, row headers, and cells apart. Give each checkbox a stable accessible name ("PowerShell in Work") with its native checked state, and give every non-checkbox cell an `aria-label` naming its state. Separate whether an install is known from whether a cell can act, and give each disabled cell its real reason. Give inherited, applied-to-all, not-installed, and unknown cells distinct glyphs, and add a short legend. Preserve keyboard focus across rebuilds and when the hover card closes. Move the table renderer where a jsdom test can call it. | `main.ts`, `style.css`, `render.ts`, a new matrix DOM test | None |
| 2. Extension data | Keep each manifest entry's folder reference, and add `categories` from that folder's `package.json` and an install source from `metadata.source` to `ExtensionRecord`, with parser and composition tests. | `types.ts`, `parsers.ts`, `inventory.ts`, `parsers.test.ts`, `inventory.test.ts` | None |
| 3. Filter model | Replace the single `chip` value with a filter state that has separate dimensions, and expose the selected view to assistive technology. Add publisher search, a debounce on the text filter, an announced result count, and session persistence for the view state. | `render.ts`, `main.ts`, `matrixPanel.ts`, `protocol.ts`, `render.test.ts` | 1 |
| 4. Category, publisher, and source filters | Add the three filter controls and the row of active-filter chips. | `main.ts`, `style.css`, `render.ts` | 2 and 3 |
| 5. Group by | Add a Group by control (None, Name, or Publisher) that renders a `tbody` per group with a heading row. Update the crosshair to skip heading rows, and keep the hover card's row index in step with the grouped order. | `main.ts`, `render.ts`, `crosshair.ts`, `crosshair.test.ts`, the matrix DOM test | 1 and 3 |
| 6. Profile order and Home names | Sort profiles once in `composeInventory` so Home and the matrix share one order. Make Home profile names plain text, and make the pencil a native `button` instead of an `a` element with `role="button"`. | `inventory.ts`, `home.ts`, `inventory.test.ts` | None |

PRs 1, 2, and 6 can proceed in parallel, and PR 6 can ship first. If any PR uncovers a larger problem, it pauses and the plan is updated before work continues.

## Design decisions

These decisions are directional. Details that depend on testing are left to the PR that implements them.

**Filter semantics.** Values within one dimension combine with "or," and dimensions combine with "and." The view chips (All, Orphaned, and Applied to all profiles) stay single-select, because each one is a different lens rather than an attribute. All filter logic lives in pure functions in `render.ts`, so it can be unit-tested without a DOM.

**Filter controls.** Category, Publisher, and Source are disclosure buttons (with `aria-expanded`) that each open a group of native, labelled checkboxes rather than ARIA menus, so Tab moves through the values and no arrow-key model is needed. Each value shows how many rows match it under the other active filters. The count does not promise the total after a click, and a row with several categories or sources counts once under each of its values. The Publisher group gets its own search box when it has more than 10 values. Escape closes an open group and returns focus to its button. Active filters appear as removable chips with names such as "Remove publisher Microsoft filter," beside a Clear filters button. If the three buttons do not fit the toolbar, a single Filters disclosure holding all three groups is the fallback.

**View chips.** The view chips (All, Orphaned, and Applied to all profiles) expose which one is selected, either as a native radio group or with `aria-pressed`.

**Categories.** PR 2 keeps a validated folder reference from each manifest entry and reads categories from the folder it names, because the manifest version alone cannot identify a platform-specific folder. When that reference is missing or its folder is unavailable, PR 2 defines a deterministic fallback that skips obsolete folders, and it tests that choice. A row without categories, including a workspace-only row, falls under Unknown.

**Install source.** The record keeps every distinct `metadata.source` value across profiles, because one extension can be installed from the Marketplace in one profile and from a VSIX in another. Labels are Marketplace (`gallery`), VSIX (`vsix`), Other, and Unknown (no value). A row matches the filter when any of its sources matches.

**Publisher.** The filter key is the lowercase publisher ID, and the label is `publisherDisplayName` when present. Workspace-only rows that lack this data fall under Unknown.

**Group by.** Grouping renders one `tbody` per group, headed by a row with a single `th scope="rowgroup"` that spans the table and shows the group's count. Name groups run A to Z by the first character of the trimmed name with accents removed. A final "#" group holds every name whose first character is not a Latin letter, so every row lands in exactly one group. Groups are not collapsible in the first version, which keeps the focus model simple.

**Cell states.** The view model separates what is known about an install (installed, not installed, or unknown because a list could not be read) from whether the cell can act and why not. Profiles that inherit from an unreadable Default are unknown too. Each state gets a glyph that differs in shape, not only color, plus screen reader text and a legend entry. Pending, inherited, applied-to-all, unknown, and workspace-only cells each get their own description. The glyphs must stay legible in high-contrast themes.

**Focus.** A rebuild restores keyboard focus to the same control, keyed by extension, profile, and control type. A cell that becomes pending keeps focus through a focusable pending state, and its checkbox takes focus back when the change completes, unless the person has moved focus elsewhere in the meantime. Only when a cell or row is actually removed, such as a row that was filtered out, does focus move to a defined nearby control, such as the row header or the filter box. A rebuild never moves focus that was outside the matrix. Pressing Escape inside the hover card returns focus to the extension name that owns it without reopening the card, while pointer dismissal and tabbing away do not move focus.

**State persistence.** The view, filters, and grouping survive hiding the panel, which `retainContextWhenHidden` already provides. To also survive closing and reopening the panel, the extension host keeps them in memory for the session and sends them to the new panel, because webview state is destroyed with its panel. They are not saved across VS Code restarts.

**Performance.** The text filter gets a short debounce, and the hover card uses one delegated listener instead of one per row. Any deeper change to the full-table rebuild waits for a measurement with at least 300 extensions and 6 profiles.

**Profile order.** Default comes first and the Agents window profile second, followed by every other profile in a case-insensitive natural sort, so "Profile 2" comes before "Profile 10". The Agents window column sits beside Default because its cells mirror Default's. Moving it to the end of the matrix is the recorded fallback if that placement reads poorly.

**Home profile names.** Removing the name link also removes the read-only view of a profile's `extensions.json`, because only the link offers it. Sam is confirming whether that loss is acceptable, so PR 6 should not merge until he decides.

**Announcements.** A polite live region announces the result count ("42 of 180 extensions") after each filter change.

## Verification plan

Each PR must pass `npm run lint`, `npm test`, and `npm run test:integration` before review, plus the checks below.

| Check | How | PRs |
| --- | --- | --- |
| Filter logic | Unit tests in `render.test.ts` for each view, each filter dimension, the and/or combination, inheriting profiles, unreadable profiles, and workspace-only rows. | 3, 4 |
| Parsing | Unit tests in `parsers.test.ts` and `inventory.test.ts` for missing or malformed `categories`, missing `metadata`, an extension with different sources in two profiles, conflicting categories across current and obsolete version folders, a platform-suffixed folder, several folders that share one version, and a manifest entry without a folder reference. | 2 |
| Matrix DOM | jsdom tests, following `powershellRender.test.ts`, for focus through a toggle from pending to complete, an unrelated refresh, removal of the focused row, and Escape from the hover card. They also cover row-header classification in the crosshair, accessible names and checked states, filter-chip removal, and grouped row indexing. These tests do not replace the NVDA and theme checks. | 1, 3, 4, 5 |
| Profile order | Unit tests in `inventory.test.ts` for Default first, the Agents window profile second, natural number order, mixed case, and the Agents window setting turned off, plus a manual check that the Home list and the matrix columns match. | 6 |
| Grouping and crosshair | Unit tests for group order, the "#" group, accented and non-Latin names, every row appearing exactly once, and crosshair indexing that skips heading rows. | 5 |
| Screen reader | A manual pass with NVDA on Windows that checks cell names, row headers, group headings, menu focus, the result announcement, and the Home pencil button. | 1, 3, 4, 5, 6 |
| Keyboard | Every control is reachable by Tab, filter groups and the Home pencil button open with Enter or Space, Escape returns focus to the filter button, toggling a checkbox keeps focus on that cell while it is pending and after it completes, and Escape from the hover card returns focus to the extension name. | 1, 3, 4, 5, 6 |
| Themes | Light, dark, and both high-contrast themes, checking glyphs, chips, and focus rings. | 1, 4, 5 |
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