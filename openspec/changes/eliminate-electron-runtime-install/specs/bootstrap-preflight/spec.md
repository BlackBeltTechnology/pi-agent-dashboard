## REMOVED Requirements

### Requirement: Per-launch managed-inventory diff against pin floor

**Reason for removal:** The bootstrap preflight existed to detect drift between `~/.pi-dashboard/node_modules/<pkg>/package.json#version` and the pin floor in `offline-packages.json`. With pi/openspec/tsx now pre-installed into `resources/server/node_modules/` at build time and `~/.pi-dashboard/` no longer used, there is no writable directory to drift, no pin floor to compare against, and no inventory to diff. The capability has no remaining purpose.

**Migration:** Pi version updates ride `electron-updater` whole-`.app` replacement. Drift between the bundled pi version and a user-installed pi version (via `npm i -g`) is impossible because the Electron arm never reads from the user's npm prefix.

#### Scenario: Preflight code paths removed

- **GIVEN** the Electron main process at launch
- **WHEN** the bootstrap state machine traverses `checking-server-health` → `launch-server`
- **THEN** no call to `runPreflight`, `readManagedInventory`, or `checkManagedInventory` SHALL occur
- **AND** the file `packages/electron/src/lib/preflight-reconcile.ts` SHALL NOT exist
- **AND** the prior `preflight-inventory` state SHALL NOT exist in the state machine

#### Scenario: Silent-install env variable has no effect

- **GIVEN** `PI_DASHBOARD_SILENT_BOOTSTRAP=1` is set in the environment
- **WHEN** the Electron app launches
- **THEN** the variable SHALL be ignored
- **AND** no reconcile or install code path SHALL be triggered
