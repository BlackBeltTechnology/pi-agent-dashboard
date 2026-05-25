## ADDED Requirements

### Requirement: On-demand Electron build workflow
The project SHALL provide a GitHub Actions workflow `.github/workflows/ci-electron.yml` triggered only by `workflow_dispatch`. The workflow SHALL produce the full Electron installer matrix (DMG / AppImage / DEB / Windows ZIP + portable .exe) for the dispatching branch, with the matrix subset selectable via a `legs` input accepting `all`, `darwin`, `linux`, `win32`, or a comma-separated list of `<platform>-<arch>` tokens.

#### Scenario: Manual dispatch from any branch
- **WHEN** a repo collaborator clicks "Run workflow" on `ci-electron.yml` from a feature branch
- **THEN** the workflow SHALL check out that branch's HEAD commit, compute a CI version slug, and run the full Electron matrix unless `legs` is narrowed

#### Scenario: Matrix subset selection
- **WHEN** the dispatcher sets `legs: linux-x64`
- **THEN** only the `linux-x64` matrix leg SHALL execute end-to-end; all other legs SHALL short-circuit via `if:` guard within five seconds

#### Scenario: No dispatch trigger from push or PR
- **WHEN** a commit is pushed or a pull request is opened
- **THEN** `ci-electron.yml` SHALL NOT run; only `workflow_dispatch` SHALL invoke it

### Requirement: CI version-slug format
The on-demand workflow SHALL assign every build a SemVer-valid prerelease slug of the form `<base>-ci.<UTC-stamp>.<branch-slug>.<sha7>` where `base` is the root `package.json` version, `UTC-stamp` is `YYYYMMDD-HHMMSS` from `date -u`, `branch-slug` is `GITHUB_REF_NAME` with `[^a-zA-Z0-9.-]` replaced by `-` then truncated to 20 chars with leading/trailing `.` and `-` stripped, and `sha7` is the first seven hex chars of `GITHUB_SHA`. The slug SHALL match the SemVer regex `^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?(\+[A-Za-z0-9.-]+)?$`.

#### Scenario: Branch name sanitisation
- **WHEN** dispatched from a branch named `feature/foo-bar`
- **THEN** the slug SHALL contain `feature-foo-bar` (the `/` is replaced) and SHALL validate against the SemVer regex

#### Scenario: Slug ranks below stable
- **WHEN** the resolved slug is `0.5.3-ci.20260525-143000.develop.abc1234` and the latest published stable is `0.5.2`
- **THEN** SemVer comparison SHALL rank the slug strictly below `0.5.3` and strictly above `0.5.2`, guaranteeing that no `electron-updater` client with `allowPrerelease: false` (the default) sees it as an update target

#### Scenario: Slug visible in run summary
- **WHEN** the version-resolver step completes
- **THEN** the resolved slug, branch, and `sha7` SHALL be written to `GITHUB_STEP_SUMMARY` for the dispatcher to copy

### Requirement: No side effects on registries or update channels
The on-demand workflow SHALL NOT execute any of: `npm publish`, `softprops/action-gh-release`, `actions/create-release`, `git tag` (push), or `git push origin v*`. The reusable build workflow it calls SHALL also not contain any of these actions; publishing remains the sole responsibility of `publish.yml`.

#### Scenario: Lint enforces no-side-effects invariant
- **WHEN** the repo-lint test scans `ci-electron.yml` and `_electron-build.yml`
- **THEN** the test SHALL fail if any of `softprops/action-gh-release`, `actions/create-release`, `npm publish`, or a tag-pushing `git push` invocation appears in either file

#### Scenario: Installed user not auto-updated by CI build
- **WHEN** a CI dispatch completes and an installed Electron app on the previous stable runs its auto-update check
- **THEN** the app SHALL NOT surface an update prompt for the CI build, because no GitHub Release was created

### Requirement: Artifact upload and retention
The workflow SHALL upload each leg's `packages/electron/out/make/**/*` via `actions/upload-artifact@v4` with a unique artifact name embedding platform, arch, and `sha7`, a retention of 14 days, and `if-no-files-found: error`. Artifacts SHALL be downloadable from the Actions run page by repo collaborators.

#### Scenario: Artifact naming
- **WHEN** the `linux-x64` leg uploads for commit `abc1234`
- **THEN** the artifact name SHALL be `electron-linux-x64-abc1234`

#### Scenario: Empty output fails the leg
- **WHEN** `forge make` completes without producing any files under `out/make/`
- **THEN** the upload step SHALL fail the leg with `if-no-files-found: error` rather than uploading an empty archive

#### Scenario: Retention bounded
- **WHEN** an artifact is older than 14 days
- **THEN** GitHub SHALL have auto-expired it; the run page MAY still exist but the artifact download MAY return 404

### Requirement: Concurrency cancellation per branch
The workflow SHALL declare a concurrency group `ci-electron-${{ github.ref }}` with `cancel-in-progress: true`, so re-dispatching on the same branch cancels the prior in-flight run. Different branches SHALL run in parallel.

#### Scenario: Re-dispatch cancels prior
- **WHEN** a CI build is running on `develop` and a second dispatch is fired on `develop` before the first finishes
- **THEN** the first run SHALL be cancelled and the second SHALL proceed

#### Scenario: Cross-branch dispatch runs in parallel
- **WHEN** a CI build is running on `develop` and a dispatch is fired on `feature/foo`
- **THEN** both runs SHALL proceed concurrently without cancellation

### Requirement: Bundled-server source-only mode
The on-demand workflow SHALL invoke `packages/electron/scripts/bundle-server.mjs` with `--source-only` (or an equivalent input flag plumbed through the reusable workflow) so the bundled server resolves `@blackbelt-technology/*` workspace packages from local source instead of the npm registry. This removes the publish-ordering dependency that release builds rely on.

#### Scenario: CI build does not depend on registry availability
- **WHEN** the on-demand workflow runs
- **THEN** the bundle step SHALL succeed even if the resolved version slug has never been published to npm
