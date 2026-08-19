## ADDED Requirements

### Requirement: Site lockfile MUST stay in sync with its manifest

`site/` is deliberately not a pnpm workspace member (`pnpm-workspace.yaml` lists `packages/*` only) and installs with `npm ci` against its own `site/package-lock.json`. No existing check covers it: `verify-lockfile-versions.mjs` parses `pnpm-lock.yaml`'s `importers` map and runs only in `publish.yml` and `_electron-build.yml`.

The repository SHALL provide a check that fails when `site/package.json` and `site/package-lock.json` disagree, and SHALL run it on every push to `develop` and every pull request targeting `develop`, so drift fails on the pull request rather than mid-deploy.

The check SHALL cover `dependencies`, `devDependencies`, and `optionalDependencies`. Scoping it to `dependencies` alone would be vacuous: the drift that motivated this requirement was `vitest`, a devDependency.

The check SHALL detect range-only drift, not merely a missing name. A dependency whose declared range changes without the lockfile being regenerated is rejected by `npm ci`, so a name-presence check would pass while the deploy fails.

#### Scenario: Drifted lockfile fails the pull request

- **GIVEN** `site/package.json` declares a dependency that `site/package-lock.json` does not record
- **WHEN** the CI workflow runs on a pull request
- **THEN** the check SHALL exit non-zero and name the offending dependency

#### Scenario: Range-only drift is detected

- **GIVEN** a dependency whose declared range in `site/package.json` was changed without regenerating `site/package-lock.json`
- **WHEN** the check runs
- **THEN** it SHALL exit non-zero, matching the outcome `npm ci` would produce

#### Scenario: devDependency drift is detected

- **GIVEN** a devDependency present in `site/package.json` but absent from `site/package-lock.json`
- **WHEN** the check runs
- **THEN** it SHALL exit non-zero

#### Scenario: Synchronized lockfile passes

- **GIVEN** `site/package-lock.json` was regenerated after the most recent `site/package.json` edit
- **WHEN** the check runs
- **THEN** it SHALL exit zero and the workflow proceeds
