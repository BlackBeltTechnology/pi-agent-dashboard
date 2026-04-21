## ADDED Requirements

### Requirement: Bundled-extensions step in publish workflow
The CI publish workflow SHALL run `packages/electron/scripts/bundle-recommended-extensions.sh` before `packages/electron/scripts/bundle-server.sh` on every release build, with `BUNDLE_RECOMMENDED_EXTENSIONS=1` set.

#### Scenario: Release build order
- **WHEN** `.github/workflows/publish.yml` builds a release artifact
- **THEN** it SHALL execute `bundle-recommended-extensions.sh` before `bundle-server.sh` with the opt-in env var set

#### Scenario: Non-release builds skip bundling
- **WHEN** a feature-branch or PR build runs locally (`npm run build`, forge make without the env var)
- **THEN** the bundling script SHALL be a no-op and `resources/bundled-extensions/` SHALL NOT be created

#### Scenario: Fresh clone of each release
- **WHEN** the bundling script runs in CI
- **THEN** it SHALL clone the configured ref (default: default branch HEAD) fresh every time — no caching of previously bundled source trees between CI runs

### Requirement: Size budget enforcement in CI
The CI workflow SHALL report and gate on the size of `resources/bundled-extensions/` after bundling.

#### Scenario: Size reported
- **WHEN** bundling completes in CI
- **THEN** the workflow step SHALL print the total bundled size and per-id breakdown to the CI log

#### Scenario: Size exceeds threshold
- **WHEN** the total bundled size exceeds 15 MB
- **THEN** the CI workflow SHALL fail before proceeding to `forge make`
