### Requirement: CI workflow on push and PR
The project SHALL have a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on every push to `main` and on every pull request targeting `main`. The workflow SHALL execute lint, test, and build steps in sequence on Node.js 22.

#### Scenario: PR triggers CI
- **WHEN** a pull request is opened or updated targeting the `main` branch
- **THEN** the CI workflow SHALL run `npm ci`, `npm run lint`, `npm test`, and `npm run build` in that order

#### Scenario: Push to main triggers CI
- **WHEN** a commit is pushed directly to `main`
- **THEN** the CI workflow SHALL run the same lint, test, and build steps

#### Scenario: CI failure blocks merge
- **WHEN** any CI step (lint, test, or build) fails
- **THEN** the workflow SHALL report a failed status check on the PR

### Requirement: Publish workflow on version tags
The project SHALL have a GitHub Actions workflow (`.github/workflows/publish.yml`) that triggers when a tag matching `v*` is pushed (or via `workflow_dispatch` with a `version` input). The workflow SHALL run lint, test, and build steps and then publish the package to npm with public access and provenance, then build Electron distributables on a per-OS matrix (macOS, Linux x64, Linux arm64, Windows x64, Windows arm64). The Electron matrix SHALL execute build orchestration via `.mjs` scripts (Node-native) for any logic that runs on more than one OS; SHALL NOT use `shell: bash` on any Windows-reachable step.

#### Scenario: Version tag triggers publish
- **WHEN** a tag matching `v*` (e.g., `v1.0.0`) is pushed
- **THEN** the publish workflow SHALL run lint, test, build, and then `npm publish --access public --provenance`

#### Scenario: Publish uses NPM_TOKEN secret
- **WHEN** the publish step runs
- **THEN** it SHALL authenticate to npm using the `NPM_TOKEN` repository secret via the `NODE_AUTH_TOKEN` environment variable

#### Scenario: CI failure prevents publish
- **WHEN** lint, test, or build fails during the publish workflow
- **THEN** the npm publish step SHALL NOT execute

#### Scenario: Windows electron build invokes only Windows-native tooling
- **WHEN** the electron matrix's `windows-latest` variant runs
- **THEN** every step SHALL execute via `cmd.exe` (default), `pwsh`, or directly via `node` — no step SHALL execute via `bash`
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
The `prepare` job in `.github/workflows/publish.yml` SHALL compute a boolean `is_prerelease` from the resolved version string (true iff the version matches the regex `^[0-9]+\.[0-9]+\.[0-9]+-`, indicating a SemVer prerelease segment) and expose it as a job output. The `publish` job SHALL pass `--tag next` to every `npm publish` invocation when `is_prerelease` is `"true"`, otherwise SHALL omit the flag (default `latest`). The `github-release` job SHALL pass the same `is_prerelease` value to `softprops/action-gh-release@v2`'s `prerelease` parameter.

This requirement exists because today's workflow publishes every version under the `latest` dist-tag and creates every Release with `prerelease: false`. A version like `0.4.5-rc.1` would land on `latest`, immediately exposing the rc to every user running `npm install -g @blackbelt-technology/pi-agent-dashboard` — the opposite of what "release candidate" should mean. Symmetrically, GitHub Releases tooling that filters by prerelease state would not see the rc.

#### Scenario: prepare job exposes is_prerelease output
- **WHEN** the `prepare` job runs (tag-push or workflow_dispatch)
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
The `packages/shared/src/__tests__/publish-workflow-contract.test.ts` test SHALL be extended to assert the three prerelease wiring sites that must stay in lockstep: the `prepare` job's `outputs.is_prerelease` declaration, the `publish` job's per-package npm publish loop conditioning `--tag next` on `is_prerelease == 'true'`, and the `github-release` job forwarding `is_prerelease` to the `prerelease` parameter of `softprops/action-gh-release@v2`. Failure messages SHALL cite change `eliminate-bash-on-windows-runners`.

#### Scenario: Test fails when prepare job lacks the is_prerelease output
- **WHEN** a contributor edits `publish.yml` and removes the `is_prerelease` line from the `prepare` job's `outputs:` block
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
The release-pipeline `prepare` job in `.github/workflows/publish.yml` SHALL regenerate `package-lock.json` immediately after bumping workspace versions and rewriting cross-ref specifiers, so that the tagged commit contains a lockfile in which every cross-ref specifier matches `^<current-root-version>` exactly. Without this, strict prerelease semver causes `npm ci` on consumers (and the publish job's own CI) to fall back to registry-published tarballs of workspace dependencies, masking the in-tree workspace via nested installs.

#### Scenario: prepare job runs lockfile regen between sync-versions and commit
- **WHEN** the `prepare` job in `publish.yml` runs the `Bump versions and update CHANGELOG` step (or successor)
- **THEN** the job SHALL execute `npm install --package-lock-only --no-audit --no-fund` AFTER `node scripts/sync-versions.js` and BEFORE the `git commit -m "chore(release): ..."` step
- **AND** the regenerated `package-lock.json` SHALL be staged by the existing `git add -A` step and included in the release commit

#### Scenario: prepare job verifies lockfile after regen
- **WHEN** the prepare job has regenerated the lockfile
- **THEN** the job SHALL execute `node scripts/verify-lockfile-versions.mjs` BEFORE the commit step
- **AND** the script SHALL exit non-zero with a file:specifier:expected report if any cross-ref dep specifier in `package-lock.json` does not equal `^<root-version>`

#### Scenario: Repo-lint enforces the step ordering
- **WHEN** the test `publish-workflow-contract.test.ts` runs as part of `npm test`
- **THEN** it SHALL parse `.github/workflows/publish.yml` and assert the `prepare` job's step list contains the lockfile-regen step in the position `sync-versions < regen < git commit`
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
