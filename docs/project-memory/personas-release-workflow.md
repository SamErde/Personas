---
name: personas-release-workflow
description: How releases must be done for the Personas VS Code extension (release-please driven); do not hand-bump versions or publish manually
metadata: 
  node_type: memory
  type: feedback
---

For the Personas extension ([[profile-extension-manager-project]]), releases are **release-please driven** and must stay that way. Do NOT: commit version bumps directly, hand-edit `package.json`/`.release-please-manifest.json` versions as the release mechanism, or run `vsce publish <bump>` manually. Those cause the manifest/tags/GitHub-Releases to drift out of sync and make release-please emit garbage "re-collect all history / roll version backward" PRs (the exact failure the repo's `release-please.yml` comments warn about).

**Why:** on 2026-07-06 the user manually `vsce publish patch`'d (0.8.4 → published 0.8.5, tag v0.8.5 created) while the manifest still read 0.8.4 (no tag) → release-please opened a bogus "release 0.8.3" PR. Recovery: PR #21 set manifest to 0.8.5 (binds boundary to the v0.8.5 tag) and used a `Release-As: 0.8.6` commit footer to let the automation cut a clean 0.8.6.

**How to apply:**
- **Prefer PRs over direct commits to `main`.** Default to branch + PR for any change here.
- To realign release-please after out-of-band drift: set `.release-please-manifest.json` `"."` to the **actually-published** version that has a matching `vX.Y.Z` git tag (release-please resolves the boundary by falling back to the tag name), then merge.
- To force a specific next version without hand-editing package.json: add a commit with a `Release-As: X.Y.Z` footer (case-insensitive), verified against release-please docs `/googleapis/release-please`.
- When realigning, never reintroduce pre-rebrand content (the stale `deps-migration` branch and any release-please history-dump PR would revert Personas→"Profile Extension Manager" and re-add the removed mocha toolchain — do not merge/cherry-pick them).
