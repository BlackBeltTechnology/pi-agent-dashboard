## MODIFIED Requirements

### Requirement: Bundled extension manifest
The system SHALL declare the set of pi extensions pre-bundled with the Electron installer via a single exported constant `BUNDLED_EXTENSION_IDS` in `packages/shared/src/recommended-extensions.ts`. Every id in this list MUST also appear in `RECOMMENDED_EXTENSIONS`. The list SHALL be empty: the installer ships no pre-bundled extension trees, and every recommended extension installs through the recommended-extensions UI.

#### Scenario: Manifest is the single source of truth
- **WHEN** runtime code needs to know whether an extension is pre-bundled
- **THEN** it SHALL import `BUNDLED_EXTENSION_IDS` from `packages/shared/src/recommended-extensions.ts` and not hard-code the list anywhere else

#### Scenario: Bundled id must be a recommended id
- **WHEN** `BUNDLED_EXTENSION_IDS` contains an id not present in `RECOMMENDED_EXTENSIONS`
- **THEN** a test in `packages/shared/src/__tests__/` SHALL fail at build time

#### Scenario: Initial bundled set
- **WHEN** the manifest is evaluated at release time
- **THEN** it SHALL be the empty list `[]`
- **AND** an installed recommended extension SHALL NOT be reported as bundled

## REMOVED Requirements

### Requirement: Build-time bundling script

**Reason**: `packages/electron/scripts/bundle-recommended-extensions.sh` was deleted. The release workflow runs only `bundle-server.mjs`, and a contract test (`bundle-runtime-contract.test.ts`, "removed bundled-extensions step stays gone") keeps the step out of `_electron-build.yml` and `publish.yml`.
**Migration**: None. Recommended extensions install from npm via the recommended-extensions UI.

### Requirement: ExtraResource inclusion

**Reason**: `packages/electron/forge.config.ts` no longer includes `resources/bundled-extensions/` in `extraResource` (removed by change `eliminate-electron-runtime-install`).
**Migration**: None. The packaged app contains no `<resourcesPath>/bundled-extensions/` tree.

### Requirement: First-run activation via pi's package manager

**Reason**: `installBundledExtensions()` and `packages/electron/src/lib/dependency-installer.ts` were deleted with the runtime install; the setup wizard no longer activates bundled trees.
**Migration**: Recommended extensions install through the recommended-extensions UI ("Recommended manifest membership reflects first-party defaults").

### Requirement: Installer size budget

**Reason**: There is no `resources/bundled-extensions/` directory to measure, and no CI step enforces the 15 MB budget.
**Migration**: None.
