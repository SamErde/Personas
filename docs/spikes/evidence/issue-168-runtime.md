# Issue #168 hosted runtime evidence

This record retains the conclusions and provenance from the disposable hosted probes added by
[PR #171](https://github.com/SamErde/Personas/pull/171). The complete sanitized JSON remains in
the GitHub Actions artifacts; the probe is durable CI coverage and can reproduce those artifacts.

## Provenance

- Implementation head: `e9115186168dfc693ccff22c3ffe3b1bfcb736e4`
- VS Code: 1.148.0, commit `661626d0e72f97806550790a98fb87116c9db825`
- Workflow run: [45898779791](https://github.com/SamErde/Personas/actions/runs/45898779791)
- macOS evidence: artifact `vscode-runtime-evidence-macOS`, ARM64,
  extracted JSON SHA-256
  `FAF14089F667AB424CE959EB1A630E9218EDAC698C40C0E1B332D5C479A4C208`
- Linux evidence: artifact `vscode-runtime-evidence-Linux`, x64, extracted JSON SHA-256
  `E54E1338BA8B7EA253D4A8E71466259F3A4DD5BEAF218F2DCFA4F949C99718E4`

All three CI jobs passed in this run. Both runtime artifacts report the implementation head above,
`status: passed`, and successful owned-root cleanup.

## Evidence classification

| Class | What it supports |
| --- | --- |
| Existing CI | Real VS Code launches and Default-profile install/uninstall with temporary directory overrides on Ubuntu, Windows, and macOS. |
| New runtime | Platform default roots, live named-profile isolation including a shared-fixture uninstall, nested POSIX profile storage, raw `.obsolete` transitions, target-specific VSIX installation, observed physical folder form, and true Linux/macOS Portable Mode. |
| Authoritative documentation | Default `~/.vscode/extensions` roots and the Linux `data` / macOS sibling `code-portable-data` layouts. |
| Exact-build source | Corroborating `.obsolete` serialization and the optional target-platform folder suffix. |
| Unverified | Intel macOS, automatic creation of a slash-containing profile location, and a runtime-created target-suffixed folder. None is required to infer the runtime results above. |

## Runtime observations

| Claim | Linux x64 | macOS ARM64 |
| --- | --- | --- |
| Default user-data root | `$HOME/.config/Code` | `$HOME/Library/Application Support/Code` |
| Default `storage.json` | `$HOME/.config/Code/User/globalStorage/storage.json` | `$HOME/Library/Application Support/Code/User/globalStorage/storage.json` |
| Default extensions root | `$HOME/.vscode/extensions` | `$HOME/.vscode/extensions` |
| Path overrides during default probe | none | none |
| Named-profile install result | only target CLI listing and manifest gained `personas-tests.personas-hello-fixture@0.0.1` | same |
| Named-profile uninstall result | Default, control, and target returned to their before state | same |
| Shared-fixture uninstall | removing Target preserved Control's CLI entry, manifest entry, and physical folder | same |
| Nested profile manifest | `User/profiles/nested/profile-target/extensions.json` | same |
| Immediate post-CLI cleanup | fixture folder present; `.obsolete` absent | same |
| Workbench cleanup transition | raw `{"personas-tests.personas-hello-fixture-0.0.1":true}`; folder still present and explicitly obsolete | same |
| Packaged target in VSIX manifest | `linux-x64` | `darwin-arm64` |
| Physical extension folder | `personas-tests.personas-hello-fixture-0.0.1` | same |
| Portable marker | distribution-root `data` | `code-portable-data` beside `Visual Studio Code.app` |
| Portable user data | `data/user-data` | `code-portable-data/user-data` |
| Portable extensions | `data/extensions` | `code-portable-data/extensions` |
| Cleanup | process group ended; owned root removed | process group ended; owned root removed |

The normalized named-profile snapshots were identical on Linux and macOS. These are the exact
fixture-relevant CLI and manifest values retained in each artifact:

| Phase | Default | Control | Target |
| --- | --- | --- | --- |
| Before | CLI `[]`; manifest `[]` | CLI `[]`; manifest `[]` | CLI `[]`; manifest `[]` |
| After target install | CLI `[]`; manifest `[]` | CLI `[]`; manifest `[]` | CLI `["personas-tests.personas-hello-fixture@0.0.1"]`; manifest `[{"id":"personas-tests.personas-hello-fixture","version":"0.0.1","relativeLocation":"personas-tests.personas-hello-fixture-0.0.1"}]` |
| After target uninstall | CLI `[]`; manifest `[]` | CLI `[]`; manifest `[]` | CLI `[]`; manifest `[]` |

The probe also compares each complete snapshot after removing the fixture entry, so an unrelated
CLI or manifest change would fail rather than disappear from this compact extract.

The macOS probe additionally compared the resolved app-bundle parent and portable-data parent to
prove the sibling relationship. Both portable probes launched the real workbench and completed an
install/list/uninstall cycle without `--user-data-dir` or `--extensions-dir`. The default HOME did
not receive the fixture or `storage.json`.

## Source- and documentation-backed observations

CLI removal from a profile manifest did not immediately remove or mark the shared physical
extension folder on either platform. The probe retained that intermediate state, launched the
owned workbench, and then captured the raw single-entry `.obsolete` object mapping the exact folder
name to `true` while the folder remained for deferred deletion. The exact-build VS Code source
corroborates the observed shape and serialization:

- [`extensionManagementService.ts`](https://github.com/microsoft/vscode/blob/661626d0e72f97806550790a98fb87116c9db825/src/vs/platform/extensionManagement/node/extensionManagementService.ts)
  declares `Queue<IStringDictionary<boolean>>` (line 537), addresses `.obsolete` (line 472), maps
  the folder key to `true` (line 729), and writes `JSON.stringify(removed)` (line 844).
- [`extensionManagementUtil.ts`](https://github.com/microsoft/vscode/blob/661626d0e72f97806550790a98fb87116c9db825/src/vs/platform/extensionManagement/common/extensionManagementUtil.ts)
  parses an optional fourth suffix group (lines 30 and 42), defaults the target to
  `TargetPlatform.UNDEFINED` (line 50), and conditionally serializes `-targetPlatform` (line 56).
- [Extension Marketplace documentation](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_where-are-extensions-installed)
  names `~/.vscode/extensions` for both Linux and macOS.
- [Portable Mode documentation](https://code.visualstudio.com/docs/setup/portable) defines the
  distribution-local Linux `data` directory, the macOS sibling `code-portable-data` directory,
  and their `user-data` and `extensions` children.

Linux workbench launches included `--no-sandbox` because hosted extraction cannot make
`chrome-sandbox` root-owned with mode 4755. The default-path selection, CLI mutations, manifests,
physical folders, Portable Mode marker, and cleanup checks remain independent of that workbench
sandbox flag.
