## MODIFIED Requirements

### Requirement: Reusable Electron build workflow
The project SHALL provide a reusable workflow `.github/workflows/_electron-build.yml` with `on: workflow_call` that encapsulates the full 6-leg Electron matrix (darwin arm64/x64, linux x64/arm64, win32 x64/arm64). The workflow SHALL accept these inputs: `version` (string, required), `ref` (string, required), `legs` (string, default `all`), `source_only_bundle` (boolean, default `false`), `artifact_retention_days` (number, default `14`), `artifact_name_suffix` (string, default empty), `registry_url` (string, default empty), `use_dependency_cache` (boolean, default `false`), and `release_lock` (boolean, default `false`; when `true`, every leg's bundle step installs from the published runtime lock of `version` and the build fails unless the bundle records that it did). Unless `use_dependency_cache` is `true`, no build leg SHALL restore the pnpm dependency cache. The workflow SHALL be the sole definition of the Electron build matrix in the repo; `publish.yml` SHALL consume it via `uses:` rather than inlining the matrix.

#### Scenario: Release pipeline consumes reusable workflow
- **WHEN** `publish.yml` runs on a `v*` tag push
- **THEN** its `electron` job SHALL be a `uses: ./.github/workflows/_electron-build.yml` reference with `version` = resolved tag version, `ref` = resolved tag, `legs: all`, `source_only_bundle: false`, `artifact_retention_days: 90`, `use_dependency_cache: false`, `release_lock: true`

#### Scenario: On-demand pipeline consumes the same reusable workflow
- **WHEN** `ci-electron.yml` runs on `workflow_dispatch`
- **THEN** its build job SHALL be a `uses: ./.github/workflows/_electron-build.yml` reference with `source_only_bundle: false`, `ref: ${{ github.sha }}`, `artifact_retention_days: 14`, `use_dependency_cache: true`
- **AND** it SHALL NOT set `release_lock`

#### Scenario: Dependency cache is opt-out per caller
- **WHEN** `_electron-build.yml` is called with `use_dependency_cache: false`
- **THEN** no build leg SHALL restore or save the pnpm dependency cache
- **AND** when the input is omitted, no leg SHALL restore or save it either (fail-closed default)
- **AND** when a caller passes `use_dependency_cache: true` (`ci-electron.yml`, `nightly.yml`), the legs SHALL restore the `pnpm` cache

#### Scenario: Release artifact set unchanged after refactor
- **WHEN** a release tag is cut after the refactor
- **THEN** the produced artifact filenames, matrix legs, and `latest*.yml` metadata SHALL be bit-for-bit identical to the pre-refactor baseline

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
- **THEN** it SHALL invoke `_electron-build.yml` via `uses:` with `needs: [resolve, publish]` and `with: { version: <resolved>, ref: <tag>, legs: all, source_only_bundle: false, artifact_retention_days: 90, use_dependency_cache: false, release_lock: true }`

#### Scenario: CI failure prevents publish
- **WHEN** any sub-job of the gate (`ci-checks` lint/test/build, or any leg of the `smoke` matrix) fails during the publish workflow
- **THEN** the `publish` job SHALL NOT execute
- **AND** on `workflow_dispatch` entry, `tag-and-push` SHALL NOT execute, leaving no dangling commit or tag

#### Scenario: Windows electron build invokes only Windows-native tooling
- **WHEN** the reusable workflow's `windows-latest` matrix variant runs
- **THEN** every step SHALL execute via `cmd.exe` (default), `pwsh`, or directly via `node` — no step SHALL execute via `bash`
