## Purpose

Define the curated recommended-extensions manifest (`RECOMMENDED_EXTENSIONS`) and the subset bundled inside the Electron installer (`BUNDLED_EXTENSION_IDS`): membership rules, entry `source`/`requires` contract with live probing, the build-time bundling script, ExtraResource inclusion, first-run activation via pi's package manager, and the installer size budget.
## Requirements
### Requirement: Bundled extension manifest
The system SHALL declare the set of pi extensions that ship inside the Electron installer via a single exported constant `BUNDLED_EXTENSION_IDS` in `packages/shared/src/recommended-extensions.ts`. Every id in this list MUST also appear in `RECOMMENDED_EXTENSIONS`.

#### Scenario: Manifest is the single source of truth
- **WHEN** a build script or runtime installer needs to enumerate bundled extensions
- **THEN** it SHALL import `BUNDLED_EXTENSION_IDS` from `packages/shared/src/recommended-extensions.ts` and not hard-code the list anywhere else

#### Scenario: Bundled id must be a recommended id
- **WHEN** `BUNDLED_EXTENSION_IDS` contains an id not present in `RECOMMENDED_EXTENSIONS`
- **THEN** a test in `packages/shared/src/__tests__/` SHALL fail at build time

#### Scenario: Initial bundled set
- **WHEN** the manifest is evaluated at release time for v0.x
- **THEN** it SHALL contain exactly `["pi-anthropic-messages", "pi-flows"]`

### Requirement: Build-time bundling script
The project SHALL provide `packages/electron/scripts/bundle-recommended-extensions.sh` that clones each id in `BUNDLED_EXTENSION_IDS` into `packages/electron/resources/bundled-extensions/<id>/` before `bundle-server.sh` runs.

#### Scenario: Opt-in via env var
- **WHEN** the script runs with `BUNDLE_RECOMMENDED_EXTENSIONS` unset or not equal to `1`
- **THEN** it SHALL exit 0 without writing any files

#### Scenario: Clone source-only, no node_modules
- **WHEN** the script runs with `BUNDLE_RECOMMENDED_EXTENSIONS=1`
- **THEN** for each id it SHALL clone the repo from the `source` field in `RECOMMENDED_EXTENSIONS` (git sources only) and SHALL NOT run `npm install` inside the clone

#### Scenario: Commit SHA recorded
- **WHEN** an extension is bundled
- **THEN** the script SHALL write the resolved commit SHA to `resources/bundled-extensions/<id>/.bundled-sha`

#### Scenario: License allowlist enforcement
- **WHEN** an extension is cloned
- **THEN** the script SHALL read its `LICENSE` file and fail the build if the detected SPDX identifier is not in a hard-coded allowlist (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC)

#### Scenario: Non-git source rejected
- **WHEN** an id in `BUNDLED_EXTENSION_IDS` has a `source` that is not a git URL (e.g. `npm:…`, `local:…`)
- **THEN** the script SHALL fail with a clear error and SHALL NOT silently skip that id

### Requirement: ExtraResource inclusion
The Electron Forge configuration SHALL conditionally include `resources/bundled-extensions/` in `packagerConfig.extraResource` when the directory exists.

#### Scenario: Directory present at build
- **WHEN** `resources/bundled-extensions/` exists at forge-packaging time
- **THEN** the packaged app SHALL contain `<resourcesPath>/bundled-extensions/<id>/` for each bundled id

#### Scenario: Directory absent at build
- **WHEN** `resources/bundled-extensions/` does not exist (opt-in env var off)
- **THEN** the forge build SHALL succeed and the packaged app SHALL behave identically to today

### Requirement: First-run activation via pi's package manager
On first launch, the Electron app SHALL activate bundled extensions through pi's `DefaultPackageManager` so the on-disk layout and `settings.json` entries are identical to a normal install.

#### Scenario: New function `installBundledExtensions`
- **WHEN** the app completes wizard-driven dependency install
- **THEN** it SHALL call `installBundledExtensions(onProgress)` from `packages/electron/src/lib/dependency-installer.ts` before `installRecommendedExtensions(...)`

#### Scenario: Enumeration by directory presence
- **WHEN** `installBundledExtensions()` runs
- **THEN** it SHALL enumerate subdirectories of `<resourcesPath>/bundled-extensions/` and attempt activation for each one that is also listed in `BUNDLED_EXTENSION_IDS`

#### Scenario: Skip already-installed extensions
- **WHEN** a bundled id's git URL (from `RECOMMENDED_EXTENSIONS[id].source`) resolves to an existing directory via `manager.getInstalledPath(source, "user")` — i.e. `~/.pi/agent/git/<host>/<path>/` already contains that extension
- **THEN** `installBundledExtensions()` SHALL report `{ step, status: "done", output: "Already installed" }` and SHALL NOT touch the existing install

#### Scenario: Copy bundled tree into pi's git cache, persist git URL
- **WHEN** activating a bundled extension and no existing install is present
- **THEN** the implementation SHALL (a) copy `<resourcesPath>/bundled-extensions/<id>/` into `~/.pi/agent/git/<host>/<path>/` (the path pi's `installGit` would use for that source), (b) run `npm install --omit=dev` inside it if `package.json` declares any runtime dependencies, and (c) call `manager.addSourceToSettings(source, { local: false })` followed by `await manager.settingsManager.flush()` so the original git URL is persisted in `~/.pi/agent/settings.json` and `manager.update(source)` can later re-resolve upstream

#### Scenario: Bundled install contributes to skipPackages
- **WHEN** `installBundledExtensions()` completes successfully for a set of ids
- **THEN** the subsequent call to `installRecommendedExtensions(...)` SHALL receive those ids in its `skipPackages` set and SHALL NOT re-download them

#### Scenario: Bundled install failure is non-fatal to wizard
- **WHEN** activation fails for a bundled id (e.g. pi internals changed)
- **THEN** the wizard SHALL surface the error for that entry but SHALL continue with remaining recommended-extension install so the app still reaches a usable state

### Requirement: Installer size budget
CI SHALL fail when the combined size of `resources/bundled-extensions/` exceeds 15 MB to prevent silent bloat.

#### Scenario: Under budget
- **WHEN** the bundled directory size is ≤ 15 MB
- **THEN** CI SHALL print the size and continue

#### Scenario: Over budget
- **WHEN** the bundled directory size is > 15 MB
- **THEN** CI SHALL fail the build with a message naming each bundled id and its size contribution

### Requirement: Recommended manifest membership reflects first-party defaults
The `RECOMMENDED_EXTENSIONS` constant in `packages/shared/src/recommended-extensions.ts` SHALL enumerate the pi extensions the dashboard team promotes as defaults, and each entry's `source` SHALL match the published/installable artifact that satisfies it.

#### Scenario: Curated additions present
- **WHEN** the manifest is evaluated at release time
- **THEN** it SHALL contain entries for `context-mode` (status `strongly-suggested`), `pi-hermes-memory`, `@ricoyudog/pi-goal-hermes`, `@blackbelt-technology/pi-model-proxy`, and `pi-simplify`, in addition to the pre-existing required/strongly-suggested entries

#### Scenario: Source field matches the satisfying artifact
- **WHEN** an entry declares a `source`
- **THEN** that `source` SHALL resolve to the artifact that `sourcesMatch()` recognizes as satisfying the entry — specifically image-fit SHALL use `npm:@blackbelt-technology/pi-image-fit-extension` and pi-flows SHALL use `npm:@blackbelt-technology/pi-flows`

#### Scenario: pi-flows stays out of the bundled set
- **WHEN** pi-flows `source` is switched to the npm spec
- **THEN** `pi-flows` SHALL NOT be added to `BUNDLED_EXTENSION_IDS` until upstream declares an SPDX-conformant license

#### Scenario: Manifest-shape test updated
- **WHEN** entries are added or their `source` changes
- **THEN** the manifest-shape test(s) in `packages/shared/src/__tests__/` SHALL assert the new membership and pass

### Requirement: Recommended-extension external requirements are declared and probed
`RecommendedExtension` SHALL support an optional `requires` declaration (`piExtensions` / `binaries` / `services`), and the recommended route SHALL surface a live probe result per requirement.

#### Scenario: requires declared and probed
- **WHEN** a recommended entry declares `requires` (e.g. `pi-agent-browser` binary `agent-browser`)
- **THEN** `GET /api/packages/recommended` SHALL return a structured probe (`{ name, satisfied }` per category) computed with the same probe used for dashboard-plugin `requires`, and `RecommendedExtensions.tsx` SHALL render satisfied/missing state

#### Scenario: native npm deps are NOT declared as requires
- **WHEN** an extension's only external dependency is a native npm module it bundles (e.g. hermes → `better-sqlite3`)
- **THEN** it SHALL NOT declare that module under `requires.binaries` — a bundled native dep is not a user-provided system requirement

#### Scenario: unknown service names are not declared
- **WHEN** an extension's external requirement is a service absent from the closed probe registry (e.g. a self-hosted analytics server)
- **THEN** it SHALL NOT declare that name under `requires.services` (it would always report unsatisfied); the need is surfaced via the companion dashboard plugin instead

