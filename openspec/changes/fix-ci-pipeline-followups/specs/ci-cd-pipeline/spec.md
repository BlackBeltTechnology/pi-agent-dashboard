## MODIFIED Requirements

### Requirement: CI workflow on push and PR
The project SHALL have a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on every push to `develop` and on every pull request targeting `develop`. The workflow SHALL install with pnpm from the frozen lockfile and execute lint, test, and build steps in sequence on Node.js 22. The workflow SHALL NOT include the standalone-install-smoke matrix; that matrix is hosted in the reusable `_smoke.yml` and consumed by `ci-smoke.yml` (manual dispatch) and `publish.yml` (release gate) only.

#### Scenario: PR triggers CI
- **WHEN** a pull request is opened or updated targeting the `develop` branch
- **THEN** the CI workflow SHALL run `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm test`, and `pnpm run build` in that order

#### Scenario: Push to develop triggers CI
- **WHEN** a commit is pushed directly to `develop`
- **THEN** the CI workflow SHALL run the same lint, test, and build steps

#### Scenario: CI failure blocks merge
- **WHEN** any CI step (lint, test, or build) fails
- **THEN** the workflow SHALL report a failed status check on the PR

#### Scenario: Smoke matrix does not run on push or PR
- **WHEN** any `push` or `pull_request` event triggers `ci.yml`
- **THEN** no `standalone-install-smoke-linux` or `standalone-install-smoke-windows` job SHALL run
- **AND** `ci.yml` SHALL contain no such job definitions
