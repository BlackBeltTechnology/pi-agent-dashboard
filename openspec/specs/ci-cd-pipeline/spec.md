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
The project SHALL have a GitHub Actions workflow (`.github/workflows/publish.yml`) that triggers when a tag matching `v*` is pushed (or via `workflow_dispatch` with a `version` input). The workflow's `publish` job SHALL be gated by the parallel `ci-checks` (lint+test+build) and `smoke` (full standalone-install-smoke matrix) jobs; the `publish` job SHALL NOT execute if either gate sub-job fails. The workflow SHALL then invoke the reusable Electron build workflow `.github/workflows/_electron-build.yml` for the per-OS matrix (macOS arm64/x64, Linux x64/arm64, Windows x64/arm64). The reusable Electron workflow's matrix SHALL execute build orchestration via `.mjs` scripts (Node-native) for any logic that runs on more than one OS; SHALL NOT use `shell: bash` on any Windows-reachable step. The release flow SHALL retain `needs: [resolve, publish]` ordering on the electron job so the bundled server's npm install resolves the just-bumped `@blackbelt-technology/*` versions.

The legacy monolithic `prepare` job SHALL be split into `resolve` (pure version resolution, no side effects), parallel `ci-checks` + `smoke` gate jobs, and `tag-and-push` (commit+tag+push, runs only on `workflow_dispatch`). The `tag-and-push` job SHALL have `if: github.event_name == 'workflow_dispatch'`; on tag-push entry it is skipped because the tag is already present. Because GitHub Actions treats a skipped `needs:` as blocking by default, the `publish` job SHALL declare an explicit `if:` that requires `needs.ci-checks.result == 'success'` AND `needs.smoke.result == 'success'` AND `needs.tag-and-push.result` of either `success` (dispatch path) or `skipped` (tag-push path).

#### Scenario: Version tag triggers publish
- **WHEN** a tag matching `v*` (e.g., `v1.0.0`) is pushed
- **THEN** the publish workflow SHALL run `resolve` → (`ci-checks` ∥ `smoke`) → `publish` → `electron` → `github-release`
- **AND** `tag-and-push` SHALL be skipped (the tag is already pushed)
- **AND** the `publish` job's `if:` SHALL accept the skipped `tag-and-push` result
- **AND** the `publish` job SHALL invoke `npm publish --access public --provenance` only if both `ci-checks` and `smoke` succeeded

#### Scenario: Workflow dispatch triggers publish with bump
- **WHEN** an operator triggers `publish.yml` via `workflow_dispatch` with a version input
- **THEN** the publish workflow SHALL run `resolve` → (`ci-checks` ∥ `smoke`) → `tag-and-push` → `publish` → `electron` → `github-release`
- **AND** `tag-and-push` SHALL bump every workspace `package.json`, run `scripts/sync-versions.js`, regenerate `package-lock.json`, promote `CHANGELOG.md` `[Unreleased]`, commit `chore(release): vX.Y.Z`, tag `vX.Y.Z`, and push branch + tag
- **AND** `tag-and-push` SHALL only run if `ci-checks` and `smoke` succeeded — a failing gate SHALL leave no commit, no tag, and no npm artifact

#### Scenario: Publish uses npm Trusted Publisher (OIDC)
- **WHEN** the publish step runs
- **THEN** it SHALL authenticate to npm via OIDC token exchange (Trusted Publisher) using the workflow's `id-token: write` permission
- **AND** no `NPM_TOKEN` repository secret SHALL be required or referenced via `NODE_AUTH_TOKEN`

#### Scenario: Electron job consumes reusable workflow
- **WHEN** the publish workflow reaches the electron build phase
- **THEN** it SHALL invoke `_electron-build.yml` via `uses:` with `needs: [resolve, publish]` and `with: { version: <resolved>, ref: <tag>, legs: all, source_only_bundle: false, artifact_retention_days: 90 }`

#### Scenario: CI failure prevents publish
- **WHEN** any sub-job of the gate (`ci-checks` lint/test/build, or any leg of the `smoke` matrix) fails during the publish workflow
- **THEN** the `publish` job SHALL NOT execute
- **AND** on `workflow_dispatch` entry, `tag-and-push` SHALL NOT execute, leaving no dangling commit or tag

#### Scenario: Windows electron build invokes only Windows-native tooling
- **WHEN** the reusable workflow's `windows-latest` matrix variant runs
- **THEN** every step SHALL execute via `cmd.exe` (default), `pwsh`, or directly via `node` — no step SHALL execute via `bash`

### Requirement: Reusable Electron build workflow
The project SHALL provide a reusable workflow `.github/workflows/_electron-build.yml` with `on: workflow_call` that encapsulates the full 6-leg Electron matrix (darwin arm64/x64, linux x64/arm64, win32 x64/arm64). The workflow SHALL accept inputs: `version` (string, required), `ref` (string, required), `legs` (string, default `all`), `source_only_bundle` (boolean, default `false`), and `artifact_retention_days` (number, default `14`). The workflow SHALL be the sole definition of the Electron build matrix in the repo; `publish.yml` SHALL consume it via `uses:` rather than inlining the matrix.

#### Scenario: Release pipeline consumes reusable workflow
- **WHEN** `publish.yml` runs on a `v*` tag push
- **THEN** its `electron` job SHALL be a `uses: ./.github/workflows/_electron-build.yml` reference with `version` = resolved tag version, `ref` = resolved tag, `legs: all`, `source_only_bundle: false`, `artifact_retention_days: 90`

#### Scenario: On-demand pipeline consumes the same reusable workflow
- **WHEN** `ci-electron.yml` runs on `workflow_dispatch`
- **THEN** its build job SHALL be a `uses: ./.github/workflows/_electron-build.yml` reference with `source_only_bundle: true`, `ref: ${{ github.sha }}`, `artifact_retention_days: 14`

#### Scenario: Release artifact set unchanged after refactor
- **WHEN** a release tag is cut after the refactor
- **THEN** the produced artifact filenames, matrix legs, and `latest*.yml` metadata SHALL be bit-for-bit identical to the pre-refactor baseline

### Requirement: Reusable workflow MUST NOT publish or release
The reusable `_electron-build.yml` workflow SHALL NOT contain any publishing or release-creating actions (`npm publish`, `softprops/action-gh-release`, `actions/create-release`, or tag-pushing `git push`). All publishing remains in `publish.yml`'s `publish` and `github-release` jobs, which run before and after the reusable workflow respectively.

#### Scenario: Lint enforces clean separation
- **WHEN** the repo-lint test scans `_electron-build.yml`
- **THEN** the test SHALL fail if any of the forbidden actions appears

### Requirement: Node.js version
Both CI and publish workflows SHALL use Node.js 22 as the runtime version.

#### Scenario: Node 22 used in CI
- **WHEN** the CI workflow runs
- **THEN** it SHALL set up Node.js 22 using `actions/setup-node`

### Requirement: npm provenance
The publish workflow SHALL use the `--provenance` flag when publishing to npm to provide supply chain transparency.

#### Scenario: Package published with provenance
- **WHEN** the package is published to npm
- **THEN** the published package SHALL include provenance attestation linking it to the source commit and GitHub Actions build

### Requirement: No `shell: bash` on Windows-runnable workflow steps
No step in `.github/workflows/publish.yml` or `.github/workflows/ci.yml` SHALL combine `shell: bash` with a runtime configuration that can run on a Windows runner. The combination is forbidden because Git for Windows' MSYS2 layer translates POSIX-style paths in a way that does not survive being embedded in arguments to native binaries (notably `node.exe` and `cmd.exe` shims), producing a recurring class of latent bugs. Cross-OS build orchestration SHALL be expressed in `.mjs` scripts invoked by `node`. POSIX-only steps MAY use `shell: bash` provided they are gated by an `if:` filter that excludes Windows. Windows-only steps MAY use `shell: pwsh`.

#### Scenario: workflow has zero Windows-reachable bash steps
- **WHEN** `.github/workflows/publish.yml` is parsed and each step's matrix-platform reachability is computed
- **THEN** no step that is reachable on `windows-latest` SHALL declare `shell: bash`

#### Scenario: POSIX-only bash step is allowed
- **WHEN** a step declares `shell: bash` AND its `if:` filter evaluates to false on every Windows matrix variant
- **THEN** the step is permitted (the bash invocation never reaches a Windows runner)

#### Scenario: Windows-only pwsh step is allowed
- **WHEN** a step declares `shell: pwsh` AND its `if:` filter restricts execution to Windows variants
- **THEN** the step is permitted (Windows-native shell, no MSYS dependency)

### Requirement: Repo-lint test enforces the no-bash-on-Windows invariant
The repository SHALL contain an automated test (`packages/shared/src/__tests__/no-bash-on-windows.test.ts`) that parses the relevant workflow YAML files, computes per-step Windows reachability from the `electron` job's matrix and each step's `if:` filter, and fails when any `shell: bash` step is reachable on a Windows runner. The test SHALL run as part of `npm test` so a future workflow refactor cannot silently violate the invariant.

#### Scenario: Test fails when a Windows-reachable bash step is added
- **WHEN** a contributor adds a step with `shell: bash` and an `if:` filter that includes Windows variants (or no filter at all)
- **THEN** `npm test` SHALL fail with a message that names the step and cites change `eliminate-bash-on-windows-runners`

#### Scenario: Test passes when all bash steps are POSIX-gated
- **WHEN** every `shell: bash` step in the workflow is gated by an `if:` filter that excludes Windows
- **THEN** `npm test` SHALL pass without warnings related to the bash-on-Windows invariant

#### Scenario: Test ignores `ci.yml` steps that don't match a Windows matrix
- **WHEN** the CI workflow runs on `ubuntu-latest` only (no Windows matrix)
- **THEN** its `shell: bash` steps are NOT flagged because they are unreachable on Windows by definition

### Requirement: Prerelease versions publish to `next` dist-tag with `prerelease: true` Release
The `resolve` job in `.github/workflows/publish.yml` SHALL compute a boolean `is_prerelease` from the resolved version string (true iff the version matches the regex `^[0-9]+\.[0-9]+\.[0-9]+-`, indicating a SemVer prerelease segment) and expose it as a job output. The `publish` job SHALL pass `--tag next` to every `npm publish` invocation when `is_prerelease` is `"true"`, otherwise SHALL omit the flag (default `latest`). The `github-release` job SHALL pass the same `is_prerelease` value to `softprops/action-gh-release@v2`'s `prerelease` parameter.

This requirement exists because today's workflow publishes every version under the `latest` dist-tag and creates every Release with `prerelease: false`. A version like `0.4.5-rc.1` would land on `latest`, immediately exposing the rc to every user running `npm install -g @blackbelt-technology/pi-agent-dashboard` — the opposite of what "release candidate" should mean. Symmetrically, GitHub Releases tooling that filters by prerelease state would not see the rc.

#### Scenario: resolve job exposes is_prerelease output
- **WHEN** the `resolve` job runs (tag-push or workflow_dispatch)
- **THEN** its `outputs:` block SHALL declare `is_prerelease`
- **AND** the value SHALL be the literal string `"true"` when the resolved version matches `^[0-9]+\.[0-9]+\.[0-9]+-` (e.g. `0.4.5-rc.1`, `1.0.0-alpha.0`)
- **AND** the value SHALL be the literal string `"false"` for stable versions like `0.4.5` or `1.0.0`

#### Scenario: prerelease publishes to next, not latest
- **WHEN** the resolved version is `0.4.5-rc.1` (or any version where `is_prerelease == "true"`)
- **THEN** every `npm publish` call in the publish job's loop SHALL include `--tag next`
- **AND** the npm registry SHALL serve `0.4.5-rc.1` ONLY under the `next` dist-tag
- **AND** users running `npm install @blackbelt-technology/pi-agent-dashboard` SHALL continue to receive the latest stable (NOT the rc)
- **AND** users wanting the rc SHALL opt in via `npm install @blackbelt-technology/pi-agent-dashboard@next` or `@0.4.5-rc.1`

#### Scenario: stable publishes to latest
- **WHEN** the resolved version is `0.4.5` (or any version where `is_prerelease == "false"`)
- **THEN** the publish job SHALL invoke `npm publish` WITHOUT a `--tag` flag
- **AND** the npm registry SHALL serve the version under the default `latest` dist-tag

#### Scenario: prerelease GitHub Release is marked prerelease
- **WHEN** `is_prerelease == "true"` and the `github-release` job runs
- **THEN** the `softprops/action-gh-release@v2` step SHALL set `prerelease: true`
- **AND** the Release SHALL appear with the "Pre-release" tag on the GitHub Releases page

#### Scenario: stable GitHub Release is NOT marked prerelease
- **WHEN** `is_prerelease == "false"` and the `github-release` job runs
- **THEN** the `softprops/action-gh-release@v2` step SHALL set `prerelease: false`
- **AND** the Release SHALL appear as a regular release

### Requirement: Prerelease wiring is asserted by the publish-workflow contract test
The `packages/shared/src/__tests__/publish-workflow-contract.test.ts` test SHALL be extended to assert the three prerelease wiring sites that must stay in lockstep: the `resolve` job's `outputs.is_prerelease` declaration, the `publish` job's per-package npm publish loop conditioning `--tag next` on `is_prerelease == 'true'`, and the `github-release` job forwarding `is_prerelease` to the `prerelease` parameter of `softprops/action-gh-release@v2`. Failure messages SHALL cite change `eliminate-bash-on-windows-runners`.

#### Scenario: Test fails when resolve job lacks the is_prerelease output
- **WHEN** a contributor edits `publish.yml` and removes the `is_prerelease` line from the `resolve` job's `outputs:` block
- **THEN** `npm test` SHALL fail with a message that names the missing output and cites this change

#### Scenario: Test fails when publish loop omits the prerelease conditional
- **WHEN** a contributor edits `publish.yml` and removes the `--tag next` argument or the `is_prerelease`-keyed conditional from the publish job's npm publish invocation
- **THEN** `npm test` SHALL fail with a message identifying the publish step and citing this change

#### Scenario: Test fails when github-release job omits the prerelease wire
- **WHEN** a contributor edits `publish.yml` and removes the `prerelease:` parameter (or its `is_prerelease`-keyed expression) from the `softprops/action-gh-release` step
- **THEN** `npm test` SHALL fail with a message identifying the github-release step and citing this change

#### Scenario: Test passes on the corrected workflow
- **WHEN** the workflow declares the output, conditions `--tag next` on the output, and forwards the output to `softprops/action-gh-release`'s `prerelease` parameter
- **THEN** `npm test` SHALL pass without warnings related to the prerelease wiring

### Requirement: Release lockfile MUST mirror workspace versions
The release-pipeline `tag-and-push` job in `.github/workflows/publish.yml` SHALL regenerate `package-lock.json` immediately after bumping workspace versions and rewriting cross-ref specifiers, so that the tagged commit contains a lockfile in which every cross-ref specifier matches `^<current-root-version>` exactly. Without this, strict prerelease semver causes `npm ci` on consumers (and the publish job's own CI) to fall back to registry-published tarballs of workspace dependencies, masking the in-tree workspace via nested installs.

#### Scenario: tag-and-push job runs lockfile regen between sync-versions and commit
- **WHEN** the `tag-and-push` job in `publish.yml` runs the `Bump versions and update CHANGELOG` step (or successor)
- **THEN** the job SHALL execute `npm install --package-lock-only --no-audit --no-fund` AFTER `node scripts/sync-versions.js` and BEFORE the `git commit -m "chore(release): ..."` step
- **AND** the regenerated `package-lock.json` SHALL be staged by the existing `git add -A` step and included in the release commit

#### Scenario: tag-and-push job verifies lockfile after regen
- **WHEN** the tag-and-push job has regenerated the lockfile
- **THEN** the job SHALL execute `node scripts/verify-lockfile-versions.mjs` BEFORE the commit step
- **AND** the script SHALL exit non-zero with a file:specifier:expected report if any cross-ref dep specifier in `package-lock.json` does not equal `^<root-version>`

#### Scenario: Repo-lint enforces the step ordering
- **WHEN** the test `publish-workflow-contract.test.ts` runs as part of `npm test`
- **THEN** it SHALL parse `.github/workflows/publish.yml` and assert the `tag-and-push` job's step list contains the lockfile-regen step in the position `sync-versions < regen < git commit`
- **AND** failure SHALL cite change `fix-release-lockfile-drift` in the assertion message

#### Scenario: Local release-cut path documents the lockfile step
- **WHEN** a maintainer cuts a release manually (not via `workflow_dispatch`)
- **THEN** the `release-cut` skill in `.pi/skills/release-cut/SKILL.md` SHALL document running `npm install --package-lock-only` between `sync-versions.js` and the commit step
- **AND** `scripts/sync-versions.js` SHALL print a console hint pointing the maintainer at the right command

### Requirement: Build tools referenced by workflows MUST be declared dependencies

Every external Node.js package referenced from `.github/workflows/*.yml` — including but not limited to packages loaded via `node --import <pkg>`, `node --loader <pkg>`, `NODE_OPTIONS='--import <pkg>'`, or `npx <pkg>` — SHALL be declared in a workspace `package.json` (root or sub-package) so that `npm ci` resolves it. The publish workflow SHALL NOT rely on globally-installed packages on the GitHub Actions runner, except for the runner's preinstalled toolchain (Node.js, npm, git).

This requirement closes a class of "works on my machine" CI failures where a developer has the tool installed globally but the runner does not.

#### Scenario: tsx loader referenced by bundle script
- **WHEN** `.github/workflows/publish.yml` invokes `node --import tsx/esm packages/electron/scripts/bundle-recommended-extensions.mjs`
- **THEN** `tsx` SHALL be declared as a `devDependency` in the workspace root `package.json`
- **AND** `package-lock.json` SHALL pin a specific resolved version
- **AND** the step SHALL succeed without an `ERR_MODULE_NOT_FOUND` for `tsx`

#### Scenario: New build-tool added in a future change
- **WHEN** a future workflow step is added that invokes `node --import <new-pkg>` or `npx <new-pkg>`
- **THEN** the change proposal SHALL also add `<new-pkg>` to a workspace `package.json`
- **AND** the change SHALL regenerate `package-lock.json` in the same commit

#### Scenario: Repo-lint enforcement (optional, future)
- **WHEN** a maintainer wants to enforce this requirement automatically
- **THEN** a repo-lint test MAY be added under `packages/shared/src/__tests__/` that greps `.github/workflows/*.yml` for `--import <pkg>` / `npx <pkg>` tokens and asserts each `<pkg>` resolves from the workspace root
- **AND** absence of such a lint SHALL NOT be a blocker for this change

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
