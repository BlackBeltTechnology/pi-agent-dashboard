## MODIFIED Requirements

### Requirement: CI workflow on push and PR
The project SHALL have a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on every push to `develop` and on every pull request targeting `develop`. The workflow SHALL execute lint, test, and build steps in sequence on Node.js 22. The workflow SHALL NOT include the standalone-install-smoke matrix; that matrix is hosted in the reusable `_smoke.yml` and consumed by `ci-smoke.yml` (manual dispatch) and `publish.yml` (release gate) only.

#### Scenario: PR triggers CI
- **WHEN** a pull request is opened or updated targeting the `develop` branch
- **THEN** the CI workflow SHALL run `npm ci`, `npm run lint`, `npm test`, and `npm run build` in that order

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

### Requirement: Publish workflow on version tags
The project SHALL have a GitHub Actions workflow (`.github/workflows/publish.yml`) that triggers when a tag matching `v*` is pushed (or via `workflow_dispatch` with a `version` input). The workflow's `publish` job SHALL be gated by a `release-gate` aggregate that runs lint+test+build AND the full standalone-install-smoke matrix; the `publish` job SHALL NOT execute if any gate sub-job fails. The workflow SHALL then invoke the reusable Electron build workflow `.github/workflows/_electron-build.yml` for the per-OS matrix (macOS arm64/x64, Linux x64/arm64, Windows x64/arm64). The reusable Electron workflow's matrix SHALL execute build orchestration via `.mjs` scripts (Node-native) for any logic that runs on more than one OS; SHALL NOT use `shell: bash` on any Windows-reachable step. The release flow SHALL retain `needs: [prepare, publish]` ordering on the electron job so the bundled server's npm install resolves the just-bumped `@blackbelt-technology/*` versions.

The legacy monolithic `prepare` job SHALL be split into `resolve` (pure version resolution, no side effects), `release-gate` (parallel `ci-checks` + `smoke`), and `tag-and-push` (commit+tag+push, runs only on `workflow_dispatch`). The `tag-and-push` job SHALL have `if: github.event_name == 'workflow_dispatch'`; on tag-push entry it is skipped because the tag is already present.

#### Scenario: Version tag triggers publish
- **WHEN** a tag matching `v*` (e.g., `v1.0.0`) is pushed
- **THEN** the publish workflow SHALL run `resolve` → `release-gate` → `publish` → `electron` → `github-release`
- **AND** `tag-and-push` SHALL be skipped (the tag is already pushed)
- **AND** the `publish` job SHALL invoke `npm publish --access public --provenance` only if every `release-gate` sub-job succeeded

#### Scenario: Workflow dispatch triggers publish with bump
- **WHEN** an operator triggers `publish.yml` via `workflow_dispatch` with a version input
- **THEN** the publish workflow SHALL run `resolve` → `release-gate` → `tag-and-push` → `publish` → `electron` → `github-release`
- **AND** `tag-and-push` SHALL bump every workspace `package.json`, run `scripts/sync-versions.js`, regenerate `package-lock.json`, promote `CHANGELOG.md` `[Unreleased]`, commit `chore(release): vX.Y.Z`, tag `vX.Y.Z`, and push branch + tag
- **AND** `tag-and-push` SHALL only run if `release-gate` succeeded — a failing gate SHALL leave no commit, no tag, and no npm artifact

#### Scenario: Publish uses NPM_TOKEN secret
- **WHEN** the publish step runs
- **THEN** it SHALL authenticate to npm using the `NPM_TOKEN` repository secret via the `NODE_AUTH_TOKEN` environment variable

#### Scenario: Electron job consumes reusable workflow
- **WHEN** the publish workflow reaches the electron build phase
- **THEN** it SHALL invoke `_electron-build.yml` via `uses:` with `needs: [prepare, publish]` (where `prepare` is now satisfied by the `resolve` + `tag-and-push` chain) and `with: { version: <resolved>, ref: <tag>, legs: all, source_only_bundle: false, artifact_retention_days: 90 }`

#### Scenario: CI failure prevents publish
- **WHEN** any sub-job of `release-gate` (lint, test, build, or any leg of the smoke matrix) fails during the publish workflow
- **THEN** the `publish` job SHALL NOT execute
- **AND** on `workflow_dispatch` entry, `tag-and-push` SHALL NOT execute, leaving no dangling commit or tag

#### Scenario: Windows electron build invokes only Windows-native tooling
- **WHEN** the reusable workflow's `windows-latest` matrix variant runs
- **THEN** every step SHALL execute via `cmd.exe` (default), `pwsh`, or directly via `node` — no step SHALL execute via `bash`

## ADDED Requirements

### Requirement: Reusable standalone-install-smoke workflow
The project SHALL provide a reusable workflow `.github/workflows/_smoke.yml` with `on: workflow_call` that encapsulates the full standalone-install-smoke matrix (Linux × 6: Node 22/24/25 × bookworm-slim/alpine, plus Windows × 1: Node 22). The workflow SHALL accept input `ref` (string, required) — the git ref to check out before packing tarballs and running the install smoke. The workflow SHALL be the sole definition of the smoke matrix in the repo; both `ci-smoke.yml` (manual dispatch) and `publish.yml` (release gate) SHALL consume it via `uses:` rather than inlining the matrix.

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

### Requirement: On-demand smoke workflow via workflow_dispatch
The project SHALL provide a workflow `.github/workflows/ci-smoke.yml` with `on: workflow_dispatch` (no inputs required) that consumes `_smoke.yml` via `uses:` with `ref: ${{ github.ref }}`. Operators SHALL be able to trigger it from the GitHub Actions UI against any branch, enabling per-branch smoke validation without polluting PR feedback. The workflow SHALL declare `concurrency: { group: ci-smoke-${{ github.ref }}, cancel-in-progress: true }` so re-dispatching on the same branch cancels the prior run.

#### Scenario: Manual dispatch runs smoke on selected branch
- **WHEN** an operator clicks "Run workflow" on `ci-smoke.yml` and selects branch `feature/foo`
- **THEN** the workflow SHALL invoke `_smoke.yml` with `ref: refs/heads/feature/foo`
- **AND** the full 7-leg matrix SHALL run against that branch's HEAD

#### Scenario: Re-dispatch on same branch cancels prior run
- **WHEN** an operator dispatches `ci-smoke.yml` on `feature/foo` while a prior run on the same branch is still in progress
- **THEN** the prior run SHALL be cancelled
- **AND** the new run SHALL proceed without contention

#### Scenario: ci-smoke does not publish
- **WHEN** the repo-lint test scans `ci-smoke.yml`
- **THEN** the test SHALL fail if any publishing or release-creating action is present

### Requirement: Release-gate runs lint+test+build and smoke before publish
The `publish.yml` workflow SHALL define a `release-gate` aggregate composed of two parallel jobs:
1. `ci-checks`: runs `npm ci && npm run lint && npm test && npm run build` on `ubuntu-latest` with Node.js 22 (matches `ci.yml`'s `ci` job).
2. `smoke`: invokes `_smoke.yml` via `uses: ./.github/workflows/_smoke.yml` with `ref: ${{ needs.resolve.outputs.ref }}`.

Both jobs SHALL declare `needs: [resolve]` so they fan out in parallel after version resolution. The `publish` job SHALL declare `needs: [resolve, ci-checks, smoke, tag-and-push]`; the `tag-and-push` `needs:` entry SHALL be tolerated when skipped (tag-push entry) via GitHub Actions' default behavior treating skipped predecessors as success.

#### Scenario: Release-gate fans out in parallel
- **WHEN** the publish workflow runs (either trigger)
- **THEN** `ci-checks` and `smoke` SHALL start in parallel after `resolve` completes
- **AND** neither SHALL declare `needs:` on the other

#### Scenario: ci-checks mirrors PR CI
- **WHEN** the `ci-checks` job runs as part of `release-gate`
- **THEN** it SHALL execute `npm ci`, `npm run lint`, `npm test`, `npm run build` in that order on Node.js 22 / `ubuntu-latest`

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
2. A `ci-checks` job exists with `needs: [resolve]` and runs `npm run lint`, `npm test`, `npm run build`.
3. A `smoke` job exists with `needs: [resolve]` and is a `uses: ./.github/workflows/_smoke.yml` reference passing `ref: ${{ needs.resolve.outputs.ref }}`.
4. A `tag-and-push` job exists with `if: github.event_name == 'workflow_dispatch'`.
5. The `publish` job's `needs:` array contains all of: `resolve`, `ci-checks`, `smoke`, `tag-and-push`.

#### Scenario: Test fails when release-gate job is removed
- **WHEN** a contributor removes the `ci-checks` or `smoke` job from `publish.yml`
- **THEN** `npm test` SHALL fail with a message identifying the missing job and citing change `gate-publish-on-smoke-and-tests`

#### Scenario: Test fails when publish.needs omits a gate sub-job
- **WHEN** a contributor removes `ci-checks` or `smoke` from the `publish` job's `needs:` array
- **THEN** `npm test` SHALL fail with a message identifying the broken `needs:` contract and citing this change

#### Scenario: Test fails when tag-and-push loses its workflow_dispatch guard
- **WHEN** a contributor removes the `if: github.event_name == 'workflow_dispatch'` condition from `tag-and-push`
- **THEN** `npm test` SHALL fail because removing the guard would cause tag-push entry to attempt a second tag-and-commit on top of the human-pushed tag

#### Scenario: Test passes on the corrected workflow
- **WHEN** all five contract clauses above are satisfied
- **THEN** `npm test` SHALL pass without warnings related to the release-gate contract
