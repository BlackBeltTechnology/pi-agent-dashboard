## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Publish workflow on version tags
The project SHALL have a GitHub Actions workflow (`.github/workflows/publish.yml`) that triggers when a tag matching `v*` is pushed (or via `workflow_dispatch` with a `version` input). The workflow SHALL run lint, test, and build steps and then publish the package to npm with public access and provenance, then invoke the reusable Electron build workflow `.github/workflows/_electron-build.yml` for the per-OS matrix (macOS arm64/x64, Linux x64/arm64, Windows x64/arm64). The reusable workflow's matrix SHALL execute build orchestration via `.mjs` scripts (Node-native) for any logic that runs on more than one OS; SHALL NOT use `shell: bash` on any Windows-reachable step. The release flow SHALL retain `needs: [prepare, publish]` ordering on the electron job so the bundled server's npm install resolves the just-bumped `@blackbelt-technology/*` versions.

#### Scenario: Version tag triggers publish
- **WHEN** a tag matching `v*` (e.g., `v1.0.0`) is pushed
- **THEN** the publish workflow SHALL run lint, test, build, and then `npm publish --access public --provenance`

#### Scenario: Electron job consumes reusable workflow
- **WHEN** the publish workflow reaches the electron build phase
- **THEN** it SHALL invoke `_electron-build.yml` via `uses:` with `needs: [prepare, publish]` and `with: { version: <resolved>, ref: <tag>, legs: all, source_only_bundle: false, artifact_retention_days: 90 }`

#### Scenario: CI failure prevents publish
- **WHEN** lint, test, or build fails during the publish workflow
- **THEN** the npm publish step SHALL NOT execute

#### Scenario: Windows electron build invokes only Windows-native tooling
- **WHEN** the reusable workflow's `windows-latest` matrix variant runs
- **THEN** every step SHALL execute via `cmd.exe` (default), `pwsh`, or directly via `node` — no step SHALL execute via `bash`
