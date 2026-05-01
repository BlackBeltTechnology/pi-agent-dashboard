## ADDED Requirements

### Requirement: Electron build job depends on successful publish
The `electron` matrix job in `.github/workflows/publish.yml` SHALL declare `needs: [prepare, publish]` so that no electron variant begins execution before the `publish` job has finished uploading every workspace sub-package to the npm registry. This guarantees that any `npm install` invoked during the electron build (notably `packages/electron/scripts/bundle-server.sh`) can resolve cross-package dependencies that reference the just-bumped release version.

#### Scenario: Electron job declares publish dependency
- **WHEN** `.github/workflows/publish.yml` is parsed
- **THEN** the `electron` job SHALL list both `prepare` and `publish` in its `needs:` array

#### Scenario: Electron does not start before publish completes
- **WHEN** a release workflow is triggered (tag push or `workflow_dispatch`)
- **THEN** every electron matrix variant SHALL have `started_at` greater than or equal to the `publish` job's `completed_at`

#### Scenario: bundle-server.sh resolves the just-bumped sub-packages
- **WHEN** an electron matrix variant runs `bash packages/electron/scripts/bundle-server.sh`
- **THEN** the embedded `npm install --omit=dev` SHALL resolve every `@blackbelt-technology/*` sub-package version declared in `packages/server/package.json` against the public npm registry without `ETARGET` errors

### Requirement: Electron matrix is non-fail-fast
The `electron` matrix job SHALL set `strategy.fail-fast: false` so that a failure on one operating system or architecture does not cancel the other matrix variants. Release engineers SHALL receive complete diagnostic output for every OS regardless of whether one variant fails.

#### Scenario: One OS failure does not cancel sibling variants
- **WHEN** the macOS arm64 electron variant fails during a release run
- **THEN** the linux x64, linux arm64, windows x64, and windows arm64 variants SHALL continue running to completion (success or failure) instead of being cancelled

#### Scenario: workflow YAML declares fail-fast false
- **WHEN** `.github/workflows/publish.yml` is parsed
- **THEN** the `electron` job's `strategy` block SHALL contain `fail-fast: false`

### Requirement: Workflow YAML is asserted by an automated test
The repository SHALL contain an automated test that parses `.github/workflows/publish.yml` and asserts both invariants above (the electron job's `needs:` includes `publish`, and `strategy.fail-fast` is `false`). The test SHALL run as part of `npm test` so that a future workflow refactor cannot silently regress the dependency-graph contract.

#### Scenario: Test fails when electron lacks publish dependency
- **WHEN** a contributor edits `publish.yml` and removes `publish` from the electron job's `needs:` array
- **THEN** `npm test` SHALL fail with an error message that cites this spec requirement

#### Scenario: Test fails when fail-fast is enabled
- **WHEN** a contributor edits `publish.yml` and sets `strategy.fail-fast: true` on the electron job (or removes the key, restoring the default `true`)
- **THEN** `npm test` SHALL fail with an error message that cites this spec requirement

#### Scenario: Test passes on the corrected workflow
- **WHEN** the workflow contains `needs: [prepare, publish]` and `strategy.fail-fast: false` on the electron job
- **THEN** `npm test` SHALL pass without warnings related to the publish-electron dependency contract
