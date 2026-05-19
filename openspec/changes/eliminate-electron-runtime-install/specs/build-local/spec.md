## REMOVED Requirements

### Requirement: `BUNDLE_OFFLINE_PACKAGES` opt-in and stale-pin invalidation

**Reason for removal:** `npm run build:local` and `npm run build:local:offline` existed to produce fully offline-capable local Electron builds with stale-pin detection that regenerated the offline cacache when `offline-packages.json` changed. Because the offline cache no longer exists and bundling pi/openspec/tsx is now unconditional at build time, the opt-in flag and the stale-pin invalidation rule both lose their purpose. The `build-local.sh` wrapper becomes redundant with `electron-forge make`.

**Migration:** Local Electron builds use `npm run make` (or workspace-equivalent) directly. The `bundle-server.mjs` build step is unconditional; there is no on/off switch. `BUNDLE_OFFLINE_PACKAGES`, `BUNDLE_RECOMMENDED_EXTENSIONS`, and related environment variables are no longer read by any build script.

#### Scenario: BUNDLE_OFFLINE_PACKAGES env variable has no effect

- **GIVEN** `BUNDLE_OFFLINE_PACKAGES=1` set in the environment
- **WHEN** `npm run make` (or any local build command) runs
- **THEN** no offline cacache SHALL be generated
- **AND** no `packages/electron/resources/offline-packages/` directory SHALL exist in the built artifact
- **AND** the build SHALL produce an installer with pi/openspec/tsx pre-installed in `resources/server/node_modules/`

#### Scenario: build-local scripts removed

- **GIVEN** the repository root
- **WHEN** `npm run` is invoked to list available scripts
- **THEN** no script named `build:local` or `build:local:offline` SHALL appear
- **AND** the file `packages/electron/scripts/build-local.sh` SHALL NOT exist OR SHALL be a thin wrapper that just calls `electron-forge make`

#### Scenario: Stale-pin invalidation rule removed

- **GIVEN** the build pipeline
- **WHEN** `packages/electron/offline-packages.json` is modified
- **THEN** no cache invalidation SHALL be triggered by that change
- **AND** the file itself is removed in Phase 5; the pin source moves into `bundle-server.mjs`
