## ADDED Requirements

### Requirement: Root tarball excludes tests, fixtures and DOX sidecars under packages/

The root package's published file set SHALL NOT contain, under `packages/`, any `__tests__`, `__fixtures__` or `__mocks__` directory entry, any `*.test.*` or `*.spec.*` file, or any `AGENTS.md` or `*.AGENTS.md` file. The root `AGENTS.md` SHALL still be shipped. The exclusions SHALL be listed after every include in `files`, because npm-packlist ignores a negation that precedes the include it would narrow.

#### Scenario: Packed root has no test, fixture or sidecar files under packages/
- **WHEN** `npm pack --dry-run --json` runs at the repository root with CI's npm
- **THEN** no packed path under `packages/` contains `__tests__/`, `__fixtures__/` or `__mocks__/`, or matches `.test.`, `.spec.`, `AGENTS.md` or `.AGENTS.md`

#### Scenario: Root AGENTS.md still ships
- **WHEN** `npm pack --dry-run --json` runs at the repository root
- **THEN** the packed file set contains `AGENTS.md`

#### Scenario: Installed root boots without the excluded files
- **WHEN** the standalone install smoke (`scripts/test-standalone-npm-install.sh`, run by `publish.yml` through `_smoke.yml`) installs the packed root tarball and its workspace tarballs into an isolated `HOME`, then starts `pi-dashboard`
- **THEN** `/api/health` reports `ok: true` within the smoke's 60 s probe, and the installed root package directory contains no path under `packages/` that matches the excluded patterns
