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
| Crosshair | Indexing assumes every row has exactly one cell per column, with no spans. | `src/webview/crosshair.ts`, end of `renderContent` |
| Extension data | `ExtensionRecord` carries `publisher`, `publisherDisplayName`, `description`, and `installedTimestampMs`. It does not carry `categories` or `metadata.source`. | `src/core/types.ts`, `src/core/inventory.ts` |
| Install source | `metadata.source: "gallery"` is confirmed in real manifests. Other values such as `vsix` and `resource` are ASSERTED. | `docs/spikes/findings.md` |
| Profile counts | Home already computes per-profile counts (`direct`, `fromDefault`, `appliedToAllProfiles`). The matrix headers do not show counts. | `src/protocol.ts` (`HomeProfileVm`) |
| Profile order | Default comes first, and every other profile follows in VS Code's unsorted registry order. Home and the matrix both use this order. | `composeInventory` in `src/core/inventory.ts` |
| Home profile names | For a profile with its own extensions, the name is a link that opens its `extensions.json` read-only, and a pencil (an `a` element with `role="button"`) opens the raw file for editing with a caution. A profile that inherits Default's extensions shows a plain-text name and no pencil. | `src/webview/home.ts`, `src/panel/homeView.ts` |
| Tests | `render.test.ts` covers the view model, and `inventory.test.ts` covers parsing. | `test/unit/` |

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
| 1. Accessible cells | Make the name cell a `th scope="row"`, give each checkbox an accessible name ("Install PowerShell in Work"), and give every non-checkbox cell an `aria-label` naming its state. Give inherited, applied-to-all, and not-installed cells distinct glyphs, and add a short legend. | `main.ts`, `style.css`, `render.ts` | None |
| 2. Extension data | Add `categories` from `package.json` and an install source from `metadata.source` to `ExtensionRecord`, with parser tests. | `types.ts`, `inventory.ts`, `inventory.test.ts` | None |
| 3. Filter model | Replace the single `chip` value with a filter state that has separate dimensions. Add publisher search, a debounce on the text filter, and an announced result count. | `render.ts`, `main.ts`, `render.test.ts` | 1 |
| 4. Category, publisher, and source filters | Add the three filter menus and the row of active-filter chips. | `main.ts`, `style.css`, `render.ts` | 2 and 3 |
| 5. Group by | Add a Group by control (None, Name, or Publisher) that renders a `tbody` per group with a heading row, and update the crosshair to skip heading rows. | `main.ts`, `crosshair.ts`, `crosshair.test.ts` | 1 and 3 |
| 6. Profile order and Home names | Sort profiles once in `composeInventory` so Home and the matrix share one order. Make Home profile names plain text, and make the pencil a native `button` instead of an `a` element with `role="button"`. | `inventory.ts`, `home.ts`, `inventory.test.ts` | None |

PRs 1, 2, and 6 can proceed in parallel, and PR 6 can ship first. If any PR uncovers a larger problem, it pauses and the plan is updated before work continues.

## Design decisions

These decisions are directional. Details that depend on testing are left to the PR that implements them.

**Filter semantics.** Values within one dimension combine with "or," and dimensions combine with "and." The view chips (All, Orphaned, and Applied to all profiles) stay single-select, because each one is a different lens rather than an attribute. All filter logic lives in pure functions in `render.ts`, so it can be unit-tested without a DOM.

**Filter menus.** Category, Publisher, and Source are menu buttons that open a checklist with a count beside each value. A count reflects the other active filters, so it predicts what selecting that value will show. The Publisher menu gets its own search box when it has more than 10 values. Escape closes a menu and returns focus to its button, which matches the PowerShell row menu. Active filters appear as removable chips beside a Clear filters button.

**Install source.** The record keeps every distinct `metadata.source` value across profiles, because one extension can be installed from the Marketplace in one profile and from a VSIX in another. Labels are Marketplace (`gallery`), VSIX (`vsix`), Other, and Unknown (no value). A row matches the filter when any of its sources matches.

**Publisher.** The filter key is the lowercase publisher ID, and the label is `publisherDisplayName` when present. Workspace-only rows that lack this data fall under Unknown.

**Group by.** Grouping renders one `tbody` per group, headed by a row with a single `th scope="rowgroup"` that spans the table and shows the group's count. Name groups run A to Z, with a final "#" group for names that start with a digit or symbol. Groups are not collapsible in the first version, which keeps the focus model simple.

**Cell states.** Each state gets a glyph that differs in shape, not only color, plus screen reader text and a legend entry. The glyphs must stay legible in high-contrast themes.

**State persistence.** The view, filters, and grouping are saved with the webview's `setState` so they survive reopening the panel. They are not saved across VS Code restarts.

**Performance.** The text filter gets a short debounce, and the hover card uses one delegated listener instead of one per row. Any deeper change to the full-table rebuild waits for a measurement with at least 300 extensions and 6 profiles.

**Profile order.** Default comes first and the Agents window profile second, followed by every other profile in a case-insensitive natural sort, so "Profile 2" comes before "Profile 10". The Agents window column sits beside Default because its cells mirror Default's. Moving it to the end of the matrix is the recorded fallback if that placement reads poorly.

**Home profile names.** Removing the name link also removes the read-only view of a profile's `extensions.json`, because only the link offers it. Sam is confirming whether that loss is acceptable, so PR 6 should not merge until he decides.

**Announcements.** A polite live region announces the result count ("42 of 180 extensions") after each filter change.

## Verification plan

Each PR must pass `npm run lint`, `npm test`, and `npm run test:integration` before review, plus the checks below.

| Check | How | PRs |
| --- | --- | --- |
| Filter logic | Unit tests in `render.test.ts` for each view, each filter dimension, the and/or combination, inheriting profiles, unreadable profiles, and workspace-only rows. | 3, 4 |
| Parsing | Unit tests in `inventory.test.ts` for missing `categories`, missing `metadata`, and an extension with different sources in two profiles. | 2 |
| Profile order | Unit tests in `inventory.test.ts` for Default first, the Agents window profile second, natural number order, mixed case, and the Agents window setting turned off, plus a manual check that the Home list and the matrix columns match. | 6 |
| Grouping and crosshair | Unit tests for group order (including the "#" group) and for crosshair indexing that skips heading rows. | 5 |
| Screen reader | A manual pass with NVDA on Windows that checks cell names, row headers, group headings, menu focus, the result announcement, and the Home pencil button. | 1, 3, 4, 5, 6 |
| Keyboard | Every control is reachable by Tab, menus and the Home pencil button open with Enter or Space, and Escape returns focus to the menu button. | 3, 4, 5, 6 |
| Themes | Light, dark, and both high-contrast themes, checking glyphs, chips, and focus rings. | 1, 4, 5 |
| Performance | Time a full render with a fixture of 300 extensions and 6 profiles before and after PR 3. | 3 |

## Uncertainty log

These are the assumptions most likely to be wrong, with what would settle each one.

| Assumption | Risk if wrong | How to settle it |
| --- | --- | --- |
| `metadata.source` uses `vsix` and `resource` besides `gallery`. | The Source filter mislabels or hides some extensions. | Sideload a VSIX into a test profile and read its manifest entry. |
| Filter menus fit in the toolbar beside the view chips at a typical panel width. | The toolbar wraps into a cluttered second row. | Prototype the toolbar at 600px and 1,000px widths. |
| A `th scope="rowgroup"` heading row announces correctly in NVDA inside a sticky-header table. | Group headings are silent or announced as data. | Test the markup in NVDA before building PR 5. |
| The full-table rebuild is fast enough at 300 extensions. | Typing in the filter box lags. | Measure as described in the verification plan. |
| Faceted counts (counts that reflect other filters) are worth their complexity. | The menus are harder to build and test than plain totals. | Decide during PR 4 after seeing real data. |

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
| 1 | gpt-6-astra (Codex CLI, high reasoning) | Not yet run | None |