# Issue #168 hosted runtime evidence

This record retains the conclusions and provenance from the disposable hosted probes added by
[PR #171](https://github.com/SamErde/Personas/pull/171). The complete sanitized JSON remains in
the GitHub Actions artifacts; the probe is durable CI coverage and can reproduce those artifacts.

## Provenance

- Implementation head: `845464be5b32b7e9e952fb365c391b9e4f7a3762`
- VS Code: 1.148.0, commit `661626d0e72f97806550790a98fb87116c9db825`
- Workflow run: [45887825269](https://github.com/SamErde/Personas/actions/runs/45887825269)
- macOS evidence: attempt 1, artifact `vscode-runtime-evidence-macOS`, ARM64,
  extracted JSON SHA-256
  `5EBC6E44F85CEF8E3EA628DE2AA0895F90F736921E81738CB83F37F221EF1F68`
- Linux evidence: attempt 2 after an unrelated existing integration-test flake, artifact
  `vscode-runtime-evidence-Linux`, x64, extracted JSON SHA-256
  `58099CF4799DDDEC3E9857CD6CF52E138917D3F17F3DA25A5C905F9C8ACF1C75`

The first Ubuntu attempt never reached the new probe: an existing active-editor integration test
momentarily reported no repository open. The failed job retained no runtime artifact. The rerun
passed that test, both supported VS Code versions, and the new probe.

## Evidence classification

| Class | What it supports |
| --- | --- |
| Existing CI | Real VS Code launches and Default-profile install/uninstall with temporary directory overrides on Ubuntu, Windows, and macOS. |
| New runtime | Platform default roots, live named-profile isolation, nested POSIX profile storage, target-specific VSIX installation, observed physical folder form, and true Linux/macOS Portable Mode. |
| Authoritative documentation | Default `~/.vscode/extensions` roots and the Linux `data` / macOS sibling `code-portable-data` layouts. |
| Exact-build source | `.obsolete` serialization and the optional target-platform folder suffix. |
| Unverified | Intel macOS, automatic creation of a slash-containing profile location, a raw `.obsolete` file after uninstall, and a runtime-created target-suffixed folder. None is required to infer the runtime results above. |

## Runtime observations

| Claim | Linux x64 | macOS ARM64 |
| --- | --- | --- |
| Default user-data root | `$HOME/.config/Code` | `$HOME/Library/Application Support/Code` |
| Default `storage.json` | `$HOME/.config/Code/User/globalStorage/storage.json` | `$HOME/Library/Application Support/Code/User/globalStorage/storage.json` |
| Default extensions root | `$HOME/.vscode/extensions` | `$HOME/.vscode/extensions` |
| Path overrides during default probe | none | none |
| Named-profile install result | only target CLI listing and manifest gained `personas-tests.personas-hello-fixture@0.0.1` | same |
| Named-profile uninstall result | Default, control, and target returned to their before state | same |
| Nested profile manifest | `User/profiles/nested/profile-target/extensions.json` | same |
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

The controlled uninstalls removed the fixture directory eagerly on both platforms, so `.obsolete`
did not exist after either uninstall. The exact VS Code runtime source supplies the permitted
fallback evidence:

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
