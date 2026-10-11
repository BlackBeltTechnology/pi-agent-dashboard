## ADDED Requirements

### Requirement: Workflows declare explicit least-privilege token permissions

Every workflow under `.github/workflows/` SHALL declare the `GITHUB_TOKEN` permissions of every job explicitly. Either the workflow declares a top-level `permissions:` block, or every job in it declares a job-level `permissions:` block. No job SHALL run on the repository-default token scope.

The workflows that had no top-level `permissions:` block (`publish.yml`, `_electron-build.yml`, `_smoke.yml`, `ci-electron.yml`, `ci-smoke.yml`, `ci-e2e-electron.yml`, `ci-gateway-platform.yml`) SHALL each declare a top-level `permissions: contents: read`. Their existing job-level blocks SHALL remain unchanged, and a job that needs more than read SHALL declare it in a job-level block.

#### Scenario: Job on the default token fails repo-lint

- **WHEN** a workflow file has no top-level `permissions:` and at least one of its jobs has no job-level `permissions:`
- **THEN** the workflow-token-cache contract test SHALL fail, naming the workflow file and the job

#### Scenario: Newly scoped workflows default to read

- **WHEN** the contract test parses any of the seven listed workflows
- **THEN** its top-level `permissions` SHALL equal exactly `{contents: read}`, or the test SHALL fail naming the workflow

#### Scenario: Jobs that need write keep it via a job-level block

- **WHEN** `publish.yml` runs with a top-level `permissions: contents: read`
- **THEN** `tag-and-push`, `publish`, `github-release` and `runtime-release-assert` SHALL still run with `contents: write` from their job-level blocks
- **AND** `publish` SHALL still hold `id-token: write`, and `site-redeploy` SHALL still hold `actions: write`

### Requirement: Release-privileged jobs do not restore a dependency cache

A job's **effective permissions** are its job-level `permissions:`, else the workflow's top-level block; `write-all` counts as write on every scope. For a reusable callee they are the calling job's, evaluated per call site.

A job in any workflow, reusable callees included, is **release-privileged** when any of the following holds:

- its effective permissions grant `write` on any scope, or `id-token: write`;
- it can see a non-`GITHUB_TOKEN` secret: it references such a secret, it is a reusable-workflow call that passes `secrets:` (a mapping or `inherit`), or it declares an `environment:`;
- its output is attached to a release. Today: `publish.yml` `runtime-asset` and `publish.yml` `electron`.

Today this classifies these `publish.yml` jobs: `tag-and-push`, `publish`, `github-release`, `runtime-release-assert`, `site-redeploy`, `discord-announce`, `runtime-asset` and `electron`.

A release-privileged job SHALL NOT restore a cache. It SHALL NOT use any `actions/cache` action (cache, restore or save). None of its steps SHALL carry a non-empty value under a cache-enabling key — `cache`, `enable-cache`, `bundler-cache`, `cache-from`, `cache-to` — and expressions count as non-empty. Its dependency installs SHALL resolve from the registry; lockfile-only regeneration, which imports nothing from a store, remains allowed.

`_electron-build.yml` is the single exception. Every step there that carries a non-empty `cache` SHALL gate it on the `use_dependency_cache` input, so that caching is disabled unless the input is `true`. Such a gated step is exempt from the no-cache rule. In exchange:

- every release-privileged caller of `_electron-build.yml` SHALL pass the boolean `use_dependency_cache: false`;
- the input's default SHALL be `false`;
- `ci-electron.yml` and `nightly.yml` SHALL pass the boolean `true`.

In `publish.yml`, no job outside the ships-in-release list, and no reusable workflow called by one, SHALL upload an artifact whose name starts with `electron-`.

#### Scenario: Release job re-enabling the pnpm cache fails repo-lint

- **WHEN** `publish.yml` `publish`, `tag-and-push` or `runtime-asset` has an `actions/setup-node` step with a non-empty `with.cache`
- **THEN** the workflow-token-cache contract test SHALL fail, naming the workflow, the job and the step

#### Scenario: A new write-scoped job with actions/cache fails repo-lint

- **WHEN** any workflow gains a job whose effective permissions include a `write` scope (including `write-all`), and that job uses `actions/cache`
- **THEN** the workflow-token-cache contract test SHALL fail

#### Scenario: Secrets in a cached job fail repo-lint

- **WHEN** a job references a non-`GITHUB_TOKEN` secret, or declares an `environment:`, and also restores a cache outside the `_electron-build.yml` gated exception
- **THEN** the workflow-token-cache contract test SHALL fail

#### Scenario: Release electron build must opt out of the dependency cache

- **WHEN** a release-privileged caller of `_electron-build.yml` (for example `publish.yml` `electron`, or any caller passing `secrets:`) omits `use_dependency_cache`, or passes anything other than the boolean `false`
- **THEN** the workflow-token-cache contract test SHALL fail

#### Scenario: Callee cache must stay input-gated and default closed

- **WHEN** a step in `_electron-build.yml` carries a non-empty `cache` not gated on `inputs.use_dependency_cache` (for example a literal `cache: pnpm`), or the input's default is not `false`
- **THEN** the workflow-token-cache contract test SHALL fail

#### Scenario: Dev callers keep the cache path exercised

- **WHEN** `ci-electron.yml` `build` or `nightly.yml` `electron` stops passing the boolean `use_dependency_cache: true`
- **THEN** the workflow-token-cache contract test SHALL fail

#### Scenario: Non-shipping job uploading a release-glob artifact fails repo-lint

- **WHEN** a `publish.yml` job outside the ships-in-release list, or `_smoke.yml`, uploads an artifact whose name starts with `electron-`
- **THEN** the workflow-token-cache contract test SHALL fail, naming the job and the ships-in-release list

#### Scenario: Unprivileged non-release jobs keep their cache

- **WHEN** read-only jobs restore the pnpm cache: `publish.yml` `ci-checks`, `publish.yml` `smoke` (`_smoke.yml`), `ci.yml` jobs, or the `ci-electron.yml` / `nightly.yml` calls to `_electron-build.yml` with `use_dependency_cache: true`
- **THEN** the workflow-token-cache contract test SHALL pass

## MODIFIED Requirements

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
- **THEN** it SHALL invoke `_electron-build.yml` via `uses:` with `needs: [resolve, publish]` and `with: { version: <resolved>, ref: <tag>, legs: all, source_only_bundle: false, artifact_retention_days: 90, use_dependency_cache: false }`

#### Scenario: CI failure prevents publish
- **WHEN** any sub-job of the gate (`ci-checks` lint/test/build, or any leg of the `smoke` matrix) fails during the publish workflow
- **THEN** the `publish` job SHALL NOT execute
- **AND** on `workflow_dispatch` entry, `tag-and-push` SHALL NOT execute, leaving no dangling commit or tag

#### Scenario: Windows electron build invokes only Windows-native tooling
- **WHEN** the reusable workflow's `windows-latest` matrix variant runs
- **THEN** every step SHALL execute via `cmd.exe` (default), `pwsh`, or directly via `node` — no step SHALL execute via `bash`


### Requirement: Reusable Electron build workflow
The project SHALL provide a reusable workflow `.github/workflows/_electron-build.yml` with `on: workflow_call` that encapsulates the full 6-leg Electron matrix (darwin arm64/x64, linux x64/arm64, win32 x64/arm64). The workflow SHALL accept these inputs: `version` (string, required), `ref` (string, required), `legs` (string, default `all`), `source_only_bundle` (boolean, default `false`), `artifact_retention_days` (number, default `14`), `artifact_name_suffix` (string, default empty), `registry_url` (string, default empty), and `use_dependency_cache` (boolean, default `false`). Unless `use_dependency_cache` is `true`, no build leg SHALL restore the pnpm dependency cache. The workflow SHALL be the sole definition of the Electron build matrix in the repo; `publish.yml` SHALL consume it via `uses:` rather than inlining the matrix.

#### Scenario: Release pipeline consumes reusable workflow
- **WHEN** `publish.yml` runs on a `v*` tag push
- **THEN** its `electron` job SHALL be a `uses: ./.github/workflows/_electron-build.yml` reference with `version` = resolved tag version, `ref` = resolved tag, `legs: all`, `source_only_bundle: false`, `artifact_retention_days: 90`, `use_dependency_cache: false`

#### Scenario: On-demand pipeline consumes the same reusable workflow
- **WHEN** `ci-electron.yml` runs on `workflow_dispatch`
- **THEN** its build job SHALL be a `uses: ./.github/workflows/_electron-build.yml` reference with `source_only_bundle: false`, `ref: ${{ github.sha }}`, `artifact_retention_days: 14`, `use_dependency_cache: true`

#### Scenario: Dependency cache is opt-out per caller
- **WHEN** `_electron-build.yml` is called with `use_dependency_cache: false`
- **THEN** no build leg SHALL restore or save the pnpm dependency cache
- **AND** when the input is omitted, no leg SHALL restore or save it either (fail-closed default)
- **AND** when a caller passes `use_dependency_cache: true` (`ci-electron.yml`, `nightly.yml`), the legs SHALL restore the `pnpm` cache

#### Scenario: Release artifact set unchanged after refactor
- **WHEN** a release tag is cut after the refactor
- **THEN** the produced artifact filenames, matrix legs, and `latest*.yml` metadata SHALL be bit-for-bit identical to the pre-refactor baseline
