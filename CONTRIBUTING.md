# Contributing to Personas

Thanks for your interest in Personas. Bug reports, ideas, and pull requests are all welcome.

## Before you start

- Check the [roadmap](docs/roadmap.md) and the [open issues](https://github.com/SamErde/Personas/issues). Planned work is tracked there, and an issue is the best place to discuss a change before building it.
- Read [`GLOSSARY.md`](GLOSSARY.md) for the project's terms, and the [architecture decision records](docs/adr/) that touch the area you're changing.

## Workflow

- Work on a branch, and open a pull request against `main`. Nothing is committed to `main` directly.
- Write commit messages and PR titles as [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, …). [release-please](https://github.com/googleapis/release-please) uses them to choose the next version and write `CHANGELOG.md`.
- Don't edit version numbers or `CHANGELOG.md` by hand, and don't publish to the Marketplace manually. Merging a release PR tags and publishes the release.

## Build and test

Use the Node.js version in `.nvmrc`, then run:

```sh
npm ci
npm run lint            # type check
npm test                # unit tests (vitest)
npm run build           # bundle with esbuild
npm run test:integration  # integration tests in a sandboxed VS Code
```

[docs/local-build-test-and-release.md](docs/local-build-test-and-release.md) covers packaging, installing a build in an isolated sandbox, the manual test scenarios, and the release process.

## Where things live

| Path | Contents |
| --- | --- |
| `src/` | Extension source: `core/`, `panel/`, `webview/`, `powershell/`, `git/` |
| `test/` | Unit tests (`test/unit/`) and integration tests (`test/integration/`) |
| `docs/user-guide.md` | The full user guide |
| `docs/adr/` | Architecture decision records |
| `docs/spikes/findings.md` | Verified facts about VS Code that Personas depends on |
| `docs/design/` | Design specs |
| `docs/history.md` | Development history |
| `assets/BRAND.md` | Brand rules: name, tagline, colors, and assets |
