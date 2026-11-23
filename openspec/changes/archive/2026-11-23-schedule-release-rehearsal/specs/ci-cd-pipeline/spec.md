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

The workflow SHALL NOT include the standalone-install-smoke matrix. That matrix is hosted in the reusable `_smoke.yml` and consumed by `ci-smoke.yml` (manual dispatch), `publish.yml` (release gate) and `nightly.yml` (scheduled release rehearsal) only.

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
The project SHALL provide a reusable workflow `.github/workflows/_smoke.yml` with `on: workflow_call` that encapsulates the full standalone-install-smoke matrix (Linux × 3: Node 26 on `node:26-bookworm-slim` and `node:26-alpine`, plus an exact Node `26.0.0` floor leg on `node:26.0.0-bookworm-slim`; Windows × 1: Node 26) and the Node 26 upgrade-continuity job `standalone-install-upgrade-continuity`. It SHALL NOT carry legs for Node lines outside the server engines range, because the server refuses to start on them. The workflow SHALL accept input `ref` (string, required) — the git ref to check out before packing tarballs and running the install smoke. The workflow SHALL be the sole definition of the smoke matrix in the repo; `ci-smoke.yml` (manual dispatch), `publish.yml` (release gate) and `nightly.yml` (scheduled release rehearsal) SHALL consume it via `uses:` rather than inlining the matrix.

The reusable workflow SHALL NOT contain any publishing or release-creating actions (`npm publish`, `softprops/action-gh-release`, `actions/create-release`, or tag-pushing `git push`).

#### Scenario: Smoke matrix is defined exactly once
- **WHEN** the repo is searched for `standalone-install-smoke` job definitions
- **THEN** exactly one definition SHALL exist, in `.github/workflows/_smoke.yml`
- **AND** `ci.yml` SHALL NOT contain a `standalone-install-smoke` job
- **AND** `publish.yml` SHALL NOT inline the matrix; it SHALL `uses: ./.github/workflows/_smoke.yml`
- **AND** `nightly.yml` SHALL NOT inline the matrix; it SHALL `uses: ./.github/workflows/_smoke.yml`

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

### Requirement: On-demand smoke workflow via workflow_dispatch
The project SHALL provide a workflow `.github/workflows/ci-smoke.yml` with `on: workflow_dispatch` (no inputs required) that consumes `_smoke.yml` via `uses:` with `ref: ${{ github.ref }}`. Operators SHALL be able to trigger it from the GitHub Actions UI against any branch, enabling per-branch smoke validation without polluting PR feedback. The workflow SHALL declare `concurrency: { group: ci-smoke-${{ github.ref }}, cancel-in-progress: true }` so re-dispatching on the same branch cancels the prior run.

#### Scenario: Manual dispatch runs smoke on selected branch
- **WHEN** an operator clicks "Run workflow" on `ci-smoke.yml` and selects branch `feature/foo`
- **THEN** the workflow SHALL invoke `_smoke.yml` with `ref: refs/heads/feature/foo`
- **AND** every job `_smoke.yml` defines (the Linux and Windows standalone-install-smoke legs and the upgrade-continuity job) SHALL run against that branch's HEAD

#### Scenario: Re-dispatch on same branch cancels prior run
- **WHEN** an operator dispatches `ci-smoke.yml` on `feature/foo` while a prior run on the same branch is still in progress
- **THEN** the prior run SHALL be cancelled
- **AND** the new run SHALL proceed without contention

#### Scenario: ci-smoke does not publish
- **WHEN** the repo-lint test scans `ci-smoke.yml`
- **THEN** the test SHALL fail if any publishing or release-creating action is present

### Requirement: Release-gate runs lint+test+build and smoke before publish
The `publish.yml` workflow SHALL define a `release-gate` aggregate composed of two parallel jobs:
1. `ci-checks`: runs `pnpm install --frozen-lockfile && pnpm run lint && pnpm test && pnpm run build` on `ubuntu-latest` with Node.js 26. This is the full unit suite except the budget lane; unlike `ci.yml`, it applies no affected-test selection. It SHALL NOT run the budget lane defined by change `stabilize-blocking-test-lanes`: the `*.budget.test.*` files, which a vitest run collects only when `RUN_BUDGET_TESTS=1`. Plain `pnpm test` does not collect them, so `ci-checks` runs `pnpm test` unchanged. A wall-clock or memory assertion that is not in a budget file still runs in `ci-checks`. `RUN_BUDGET_TESTS` and `test:budget` SHALL NOT appear outside full-line `#` comments in `publish.yml`, in any reusable workflow it calls through a local `uses:`, or in a root `package.json` script that those workflows run, directly or through `npm run`. Of the repo's scripts, configs and workflows, only the root `test:budget` script sets `RUN_BUDGET_TESTS` (change `stabilize-blocking-test-lanes`), so keeping both names off the release path keeps the lane off it.
2. `smoke`: invokes `_smoke.yml` via `uses: ./.github/workflows/_smoke.yml` with `ref: ${{ needs.resolve.outputs.ref }}`.

Both jobs SHALL declare `needs: [resolve]` so they fan out in parallel after version resolution. The `publish` job SHALL declare `needs: [resolve, ci-checks, smoke, tag-and-push]`. The `tag-and-push` `needs:` entry SHALL be tolerated when skipped (tag-push entry) through an explicit `if:` on the `publish` job that accepts a `skipped` `tag-and-push` result while still requiring the gate jobs to succeed (a skipped `needs:` blocks a dependent job that has no explicit `if:`).

#### Scenario: Release-gate fans out in parallel
- **WHEN** the publish workflow runs (either trigger)
- **THEN** `ci-checks` and `smoke` SHALL start in parallel after `resolve` completes
- **AND** neither SHALL declare `needs:` on the other

#### Scenario: ci-checks mirrors PR CI
- **WHEN** the `ci-checks` job runs as part of `release-gate`
- **THEN** it SHALL execute `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm test`, `pnpm run build` in that order on Node.js 26 / `ubuntu-latest`
- **AND** `pnpm test` SHALL run the full suite except the budget lane, with no affected-test selection

#### Scenario: ci-checks does not run the budget lane
- **WHEN** the `ci-checks` job runs `pnpm test` with `RUN_BUDGET_TESTS` unset
- **THEN** no `*.budget.test.*` file SHALL be collected, and none of its code SHALL run
- **AND** cases gated on other variables that `pnpm test` does not set (for example `RUN_CI_SCENARIOS`) SHALL be skipped exactly as before this change

#### Scenario: smoke calls reusable workflow with resolved ref
- **WHEN** the `smoke` job runs as part of `release-gate`
- **THEN** it SHALL be a `uses: ./.github/workflows/_smoke.yml` reference
- **AND** SHALL pass `ref: ${{ needs.resolve.outputs.ref }}` (the sha for tag-push entry, or the branch HEAD sha at resolve time for workflow_dispatch entry)

#### Scenario: Publish job depends on both gate sub-jobs
- **WHEN** the publish workflow is parsed
- **THEN** the `publish` job's `needs:` array SHALL contain both `ci-checks` and `smoke` (or a single aggregate `release-gate` if implemented that way)
- **AND** if either sub-job fails, the `publish` job SHALL be skipped, not run

### Requirement: Repo-lint pins the release-gate contract
The `packages/shared/src/__tests__/publish-workflow-contract.test.ts` test SHALL be extended to assert the release-gate shape so that the gate cannot silently disappear in a future workflow edit. The test SHALL parse `publish.yml` and assert:
1. A `resolve` job exists with `outputs.ref` declared.
2. A `ci-checks` job exists with `needs: [resolve]` and runs `pnpm run lint`, `pnpm test`, `pnpm run build`.
3. A `smoke` job exists with `needs: [resolve]` and is a `uses: ./.github/workflows/_smoke.yml` reference passing `ref: ${{ needs.resolve.outputs.ref }}`.
4. A `tag-and-push` job exists with `if: github.event_name == 'workflow_dispatch'`.
5. The `publish` job's `needs:` array contains all of: `resolve`, `ci-checks`, `smoke`, `tag-and-push`.
6. Neither `publish.yml` nor any reusable workflow it calls through a local `uses:` (found by parsing `publish.yml`) contains `RUN_BUDGET_TESTS` or `test:budget` outside full-line `#` comments, and no root `package.json` script that those files run contains either. The scripts are the root scripts named by `pnpm test`, `pnpm run <name>` or `npm run <name>` in those files, followed through `npm run <name>` inside root scripts, plus the root `postinstall`; a name that is not a root script, and a call with `--workspace`, is not followed (today `test`, `test:parallel`, `test:real-process`, `lint`, `build` and `postinstall`).

#### Scenario: Test fails when release-gate job is removed
- **WHEN** a contributor removes the `ci-checks` or `smoke` job from `publish.yml`
- **THEN** `npm test` SHALL fail with a message identifying the missing job and citing change `gate-publish-on-smoke-and-tests`

#### Scenario: Test fails when publish.needs omits a gate sub-job
- **WHEN** a contributor removes `ci-checks` or `smoke` from the `publish` job's `needs:` array
- **THEN** `npm test` SHALL fail with a message identifying the broken `needs:` contract and citing this change

#### Scenario: Test fails when tag-and-push loses its workflow_dispatch guard
- **WHEN** a contributor removes the `if: github.event_name == 'workflow_dispatch'` condition from `tag-and-push`
- **THEN** `npm test` SHALL fail because removing the guard would cause tag-push entry to attempt a second tag-and-commit on top of the human-pushed tag

#### Scenario: Test fails when the release path enables the budget lane
- **WHEN** a contributor sets `RUN_BUDGET_TESTS` or calls `test:budget` anywhere in `publish.yml`, in a reusable workflow it calls (today `_smoke.yml` or `_electron-build.yml`), or in a root script those workflows run (today `test`, `test:parallel`, `test:real-process`, `lint`, `build` or `postinstall`)
- **THEN** `npm test` SHALL fail with a message naming `RUN_BUDGET_TESTS` and the file, and citing change `schedule-release-rehearsal`

#### Scenario: Test passes on the corrected workflow
- **WHEN** all six contract clauses above are satisfied
- **THEN** `npm test` SHALL pass without warnings related to the release-gate contract
