## MODIFIED Requirements

### Requirement: CI workflow on push and PR
The project SHALL have a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on every push to `develop` and on every pull request targeting `develop`, on Node.js 22. It SHALL install with pnpm from the frozen lockfile.

It SHALL run these jobs in parallel:
- a job named `ci` holding every repository guard, `pnpm run lint`, the E2E typecheck, Biome, `pnpm run build`, and both publish-import checks;
- a selection job that computes the affected test set per the `affected-test-selection` capability;
- a sharded unit-test job over the selected parallel-phase files, with chromium installed so browser-driving suites do not self-skip;
- a real-process job over the selected real-process files;
- a packaging-scenarios job when the selection requires it;
- the existing Docker plugin-load and Python jobs.

A shard or job with nothing selected SHALL skip its test steps and succeed.

An aggregate result job SHALL depend on every job, including the selection job. It SHALL fail in any of these cases:
- any job failed or was cancelled;
- the selection job did not succeed;
- a job that the recorded selection expected to run tests did not succeed.

It SHALL succeed only when every job the selection expected to run tests succeeded and every other job succeeded or was skipped.

The workflow SHALL be triggered by `push` to `develop`, by `pull_request` targeting `develop` (default event types), and by `workflow_dispatch`, which always runs in full mode. Runs for the same pull request SHALL share a concurrency group that cancels superseded runs. Pushes to `develop` SHALL NOT be cancelled.

The workflow SHALL NOT include the standalone-install-smoke matrix. That matrix is hosted in the reusable `_smoke.yml` and consumed by `ci-smoke.yml` (manual dispatch) and `publish.yml` (release gate) only.

#### Scenario: PR triggers CI
- **WHEN** a pull request is opened or updated targeting the `develop` branch
- **THEN** the CI workflow SHALL run `pnpm install --frozen-lockfile`, the `ci` job (including `pnpm run lint` and `pnpm run build`), and the unit tests selected for the PR's diff against its merge base with `develop`

#### Scenario: Push to develop triggers CI
- **WHEN** a commit is pushed directly to `develop`
- **THEN** the CI workflow SHALL run the same jobs, selecting unit tests for the pushed range (`before`..`after`)

#### Scenario: CI failure blocks merge
- **WHEN** any guard, selected test shard, real-process run, or required packaging-scenario run fails
- **THEN** the aggregate result job SHALL fail and the workflow SHALL report a failed status check on the PR

#### Scenario: A failed or skipped selection is never green
- **WHEN** the selection job fails, or a shard the selection assigned files to is skipped
- **THEN** the aggregate result job SHALL fail

#### Scenario: Docs-only PR runs guards and the always-run set
- **WHEN** a pull request changes only documentation or OpenSpec files
- **THEN** the `ci` job SHALL run
- **AND** the unit shards SHALL run the always-run set
- **AND** the packaging-scenarios job SHALL be skipped

#### Scenario: Guards do not wait for tests
- **WHEN** CI runs
- **THEN** the `ci` job SHALL NOT depend on any test job, and no test shard SHALL depend on the `ci` job

#### Scenario: Smoke matrix does not run on push or PR
- **WHEN** any `push` or `pull_request` event triggers `ci.yml`
- **THEN** no `standalone-install-smoke-linux` or `standalone-install-smoke-windows` job SHALL run
- **AND** `ci.yml` SHALL contain no such job definitions

### Requirement: CI uploads the vitest JSON report on every run
Every `ci.yml` and `nightly-tests.yml` job that runs vitest SHALL produce a vitest JSON report and SHALL upload it as a workflow artifact on success and on failure. This covers each unit shard, the real-process job, and the packaging-scenarios job. Artifact names SHALL be unique per job and shard, so a failed or retried timing test is attributable from the run page without log mining. A job that was cancelled before vitest wrote a report MAY upload nothing. A consumer SHALL report any job that the selection expected to run tests and that uploaded no report as having no report, and SHALL NOT treat it as passing. A shard with no assigned files is not expected to upload a report.

#### Scenario: Artifact present on a red run
- **WHEN** a unit shard fails in CI
- **THEN** an artifact containing that shard's vitest JSON report SHALL be attached to the run

#### Scenario: Artifact present on a green run
- **WHEN** a unit shard passes in CI
- **THEN** the same per-shard artifact SHALL be attached

#### Scenario: Shard artifacts do not collide
- **WHEN** several unit shards run in one workflow run
- **THEN** each SHALL upload under a distinct artifact name and all SHALL be present

### Requirement: Release-gate runs lint+test+build and smoke before publish
The `publish.yml` workflow SHALL define a `release-gate` aggregate composed of two parallel jobs:
1. `ci-checks`: runs `pnpm install --frozen-lockfile && pnpm run lint && pnpm test && pnpm run build` on `ubuntu-latest` with Node.js 22. This is the full unit suite; unlike `ci.yml`, it applies no affected-test selection.
2. `smoke`: invokes `_smoke.yml` via `uses: ./.github/workflows/_smoke.yml` with `ref: ${{ needs.resolve.outputs.ref }}`.

Both jobs SHALL declare `needs: [resolve]` so they fan out in parallel after version resolution. The `publish` job SHALL declare `needs: [resolve, ci-checks, smoke, tag-and-push]`. The `tag-and-push` `needs:` entry SHALL be tolerated when skipped (tag-push entry), via GitHub Actions' default behaviour of treating skipped predecessors as success.

#### Scenario: Release-gate fans out in parallel
- **WHEN** the publish workflow runs (either trigger)
- **THEN** `ci-checks` and `smoke` SHALL start in parallel after `resolve` completes
- **AND** neither SHALL declare `needs:` on the other

#### Scenario: ci-checks mirrors PR CI
- **WHEN** the `ci-checks` job runs as part of `release-gate`
- **THEN** it SHALL execute `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm test`, `pnpm run build` in that order on Node.js 22 / `ubuntu-latest`
- **AND** `pnpm test` SHALL run the full suite with no affected-test selection

#### Scenario: smoke calls reusable workflow with resolved ref
- **WHEN** the `smoke` job runs as part of `release-gate`
- **THEN** it SHALL be a `uses: ./.github/workflows/_smoke.yml` reference
- **AND** SHALL pass `ref: ${{ needs.resolve.outputs.ref }}` (the sha for tag-push entry, or the branch HEAD sha at resolve time for workflow_dispatch entry)

#### Scenario: Publish job depends on both gate sub-jobs
- **WHEN** the publish workflow is parsed
- **THEN** the `publish` job's `needs:` array SHALL contain both `ci-checks` and `smoke` (or a single aggregate `release-gate` if implemented that way)
- **AND** if either sub-job fails, the `publish` job SHALL be skipped, not run
