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

### Requirement: Release lockfile MUST mirror workspace versions
The release-pipeline `tag-and-push` job in `.github/workflows/publish.yml` SHALL regenerate `pnpm-lock.yaml` immediately after bumping workspace versions and rewriting cross-ref specifiers, so that the tagged commit contains a lockfile in which every cross-ref specifier matches `^<current-root-version>` exactly. Without this, strict prerelease semver causes installs on consumers (and the publish job's own CI) to fall back to registry-published tarballs of workspace dependencies, masking the in-tree workspace via nested installs.

#### Scenario: tag-and-push job runs lockfile regen between sync-versions and commit
- **WHEN** the `tag-and-push` job in `publish.yml` runs the `Bump versions and update CHANGELOG` step (or successor)
- **THEN** the job SHALL execute `pnpm install --lockfile-only` AFTER `node scripts/sync-versions.js` and BEFORE the `git commit -m "chore(release): ..."` step
- **AND** the regenerated `pnpm-lock.yaml` SHALL be staged by the existing `git add -A` step and included in the release commit

#### Scenario: tag-and-push job verifies lockfile after regen
- **WHEN** the tag-and-push job has regenerated the lockfile
- **THEN** the job SHALL execute `node scripts/verify-lockfile-versions.mjs` BEFORE the commit step
- **AND** the script SHALL exit non-zero with a file:specifier:expected report if any cross-ref dep specifier in the lockfile does not equal `^<root-version>`

#### Scenario: Repo-lint enforces the step ordering
- **WHEN** the test `publish-workflow-contract.test.ts` runs as part of `npm test`
- **THEN** it SHALL parse `.github/workflows/publish.yml` and assert the `tag-and-push` job's step list contains the lockfile-regen step in the position `sync-versions < regen < git commit`
- **AND** failure SHALL cite change `fix-release-lockfile-drift` in the assertion message

#### Scenario: Local release-cut path documents the lockfile step
- **WHEN** a maintainer cuts a release manually (not via `workflow_dispatch`)
- **THEN** the `release-cut` skill in `.pi/skills/release-cut/SKILL.md` SHALL document running `pnpm install --lockfile-only` between `sync-versions.js` and the commit step
- **AND** `scripts/sync-versions.js` SHALL print a console hint pointing the maintainer at the right command

### Requirement: Release-gate runs lint+test+build and smoke before publish
The `publish.yml` workflow SHALL define a `release-gate` aggregate composed of two parallel jobs:
1. `ci-checks`: runs `pnpm install --frozen-lockfile && pnpm run lint && pnpm test && pnpm run build` on `ubuntu-latest` with Node.js 22 (matches `ci.yml`'s `ci` job).
2. `smoke`: invokes `_smoke.yml` via `uses: ./.github/workflows/_smoke.yml` with `ref: ${{ needs.resolve.outputs.ref }}`.

Both jobs SHALL declare `needs: [resolve]` so they fan out in parallel after version resolution. The `publish` job SHALL declare `needs: [resolve, ci-checks, smoke, tag-and-push]`; the `tag-and-push` `needs:` entry SHALL be tolerated when skipped (tag-push entry) via GitHub Actions' default behavior treating skipped predecessors as success.

#### Scenario: Release-gate fans out in parallel
- **WHEN** the publish workflow runs (either trigger)
- **THEN** `ci-checks` and `smoke` SHALL start in parallel after `resolve` completes
- **AND** neither SHALL declare `needs:` on the other

#### Scenario: ci-checks mirrors PR CI
- **WHEN** the `ci-checks` job runs as part of `release-gate`
- **THEN** it SHALL execute `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm test`, `pnpm run build` in that order on Node.js 22 / `ubuntu-latest`

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
