# ADR-0004: The Extension Matrix stays neutral and offline

**Status:** Accepted

## Decision

The Extension Matrix shows what each profile contains and lets the user change it, without
judging the result:

- **Neutral.** The matrix has no views that compare profiles against each other or against a
  baseline, such as "differs between profiles" or "missing from a chosen profile". Profiles are
  allowed to differ, and that is often the point of having them.
- **Offline.** The matrix uses only data already on disk: the profile registry, each profile's
  extension list, and each installed extension's `package.json`. It never queries the Marketplace
  for install counts, ratings, tags, or other online data.

## Reason

Compare views imply that profiles ought to match, which is wrong for most persona setups
(a Writing profile shouldn't be flagged for lacking Python tools). Online data would add
network traffic, latency, and failure modes to a view that is otherwise local and instant, and
it would weaken the privacy statement. The filters and grouping users asked for work from local
data alone.

## Consequences

- Filters cover category, publisher, and install source, all read from disk.
- Other options were considered and rejected for the filters work: keyword, tag, or language
  chips (too noisy or too incomplete); group by category (an extension with several categories
  would appear in several groups and duplicate its checkboxes); and per-profile counts in the
  column headers (the VS Code Profiles view already shows them).
- Extension sets, baselines, synchronization between profiles, and a Differences view are not
  planned; [#165](https://github.com/SamErde/Personas/issues/165) records that decision. Any
  future proposal to add comparison or baseline behavior to the matrix would require superseding
  this ADR.
- Network access happens only through the `code` CLI (for example, downloading an extension the
  user installs) and links the user chooses to open.
