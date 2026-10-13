## REMOVED Requirements

### Requirement: Node.js version
**Reason**: Pins Node.js 22, which the server now refuses; its only scenario is named for Node 22.
**Migration**: Replaced by "CI and publish workflows run on the supported Node line".

## ADDED Requirements

### Requirement: CI and publish workflows run on the supported Node line
Every GitHub Actions workflow that installs, builds, tests or publishes the dashboard SHALL set up
Node.js 26 with `actions/setup-node`, including the publish legs pinned to the Electron bundled
Node major (which moves to 26 with `BUNDLED_NODE_VERSION`). Marketing-site workflows
(`deploy-site.yml`, `sync-release-version.yml`) never install or start the dashboard and are out of
scope.

#### Scenario: Node 26 used in CI
- **WHEN** the CI workflow runs
- **THEN** it SHALL set up Node.js 26 using `actions/setup-node`

#### Scenario: No workflow sets up a refused Node line
- **WHEN** the repo-lint scans `.github/workflows/*.yml` other than `deploy-site.yml` and `sync-release-version.yml` for `node-version:` values
- **THEN** every value SHALL be `26` (or a `26.x` version)

## MODIFIED Requirements

### Requirement: CI workflow on push and PR
The project SHALL have a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on every push to `develop` and on every pull request targeting `develop`, on Node.js 26 (the only supported Node line). It SHALL install with pnpm from the frozen lockfile.

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

### Requirement: Reusable standalone-install-smoke workflow
The project SHALL provide a reusable workflow `.github/workflows/_smoke.yml` with `on: workflow_call` that encapsulates the full standalone-install-smoke matrix (Linux × 2: Node 26 × bookworm-slim/alpine, plus Windows × 1: Node 26). It SHALL NOT carry legs for Node lines outside the server engines range, because the server refuses to start on them. The workflow SHALL accept input `ref` (string, required) — the git ref to check out before packing tarballs and running the install smoke. The workflow SHALL be the sole definition of the smoke matrix in the repo; both `ci-smoke.yml` (manual dispatch) and `publish.yml` (release gate) SHALL consume it via `uses:` rather than inlining the matrix.

The reusable workflow SHALL NOT contain any publishing or release-creating actions (`npm publish`, `softprops/action-gh-release`, `actions/create-release`, or tag-pushing `git push`).

#### Scenario: Smoke matrix is defined exactly once
- **WHEN** the repo is searched for `standalone-install-smoke` job definitions
- **THEN** exactly one definition SHALL exist, in `.github/workflows/_smoke.yml`
- **AND** `ci.yml` SHALL NOT contain a `standalone-install-smoke` job
- **AND** `publish.yml` SHALL NOT inline the matrix; it SHALL `uses: ./.github/workflows/_smoke.yml`

#### Scenario: Reusable workflow accepts ref input
- **WHEN** a caller invokes `_smoke.yml` via `uses:` with `ref: <sha-or-branch>`
- **THEN** every matrix leg SHALL check out the specified ref and run the smoke test against that ref's source tree

#### Scenario: Reusable workflow is publication-free
- **WHEN** the repo-lint test scans `_smoke.yml`
- **THEN** the test SHALL fail if any of `npm publish`, `softprops/action-gh-release`, `actions/create-release`, or `git push <tag>` appears

#### Scenario: Smoke matrix covers only the supported Node line
- **WHEN** `_smoke.yml` is parsed
- **THEN** every `standalone-install-smoke-*` leg SHALL use Node 26
- **AND** no leg SHALL boot the server on Node 22, 23, 24 or 25

### Requirement: Release-gate runs lint+test+build and smoke before publish
The `publish.yml` workflow SHALL define a `release-gate` aggregate composed of two parallel jobs:
1. `ci-checks`: runs `pnpm install --frozen-lockfile && pnpm run lint && pnpm test && pnpm run build` on `ubuntu-latest` with Node.js 26. This is the full unit suite; unlike `ci.yml`, it applies no affected-test selection.
2. `smoke`: invokes `_smoke.yml` via `uses: ./.github/workflows/_smoke.yml` with `ref: ${{ needs.resolve.outputs.ref }}`.

Both jobs SHALL declare `needs: [resolve]` so they fan out in parallel after version resolution. The `publish` job SHALL declare `needs: [resolve, ci-checks, smoke, tag-and-push]`. The `tag-and-push` `needs:` entry SHALL be tolerated when skipped (tag-push entry) through an explicit `if:` on the `publish` job that accepts a `skipped` `tag-and-push` result while still requiring the gate jobs to succeed (a skipped `needs:` blocks a dependent job that has no explicit `if:`).

#### Scenario: Release-gate fans out in parallel
- **WHEN** the publish workflow runs (either trigger)
- **THEN** `ci-checks` and `smoke` SHALL start in parallel after `resolve` completes
- **AND** neither SHALL declare `needs:` on the other

#### Scenario: ci-checks mirrors PR CI
- **WHEN** the `ci-checks` job runs as part of `release-gate`
- **THEN** it SHALL execute `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm test`, `pnpm run build` in that order on Node.js 26 / `ubuntu-latest`
- **AND** `pnpm test` SHALL run the full suite with no affected-test selection

#### Scenario: smoke calls reusable workflow with resolved ref
- **WHEN** the `smoke` job runs as part of `release-gate`
- **THEN** it SHALL be a `uses: ./.github/workflows/_smoke.yml` reference
- **AND** SHALL pass `ref: ${{ needs.resolve.outputs.ref }}` (the sha for tag-push entry, or the branch HEAD sha at resolve time for workflow_dispatch entry)

#### Scenario: Publish job depends on both gate sub-jobs
- **WHEN** the publish workflow is parsed
- **THEN** the `publish` job's `needs:` array SHALL contain both `ci-checks` and `smoke` (or a single aggregate `release-gate` if implemented that way)
- **AND** if either sub-job fails, the `publish` job SHALL be skipped, not run
