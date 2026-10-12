## ADDED Requirements

### Requirement: Flag dashboard-managed bridge entries

The system SHALL set `dashboardManaged: true` on a user-scope (global settings) installed-package row when its resolved path equals a path the dashboard recorded as its own in the same settings file: a value of the managed-bridge map (`dashboardPluginBridges`) or a key of the managed-package ownership map (`_dashboardManagedPackages`). Either record is sufficient. The settings file SHALL be the global pi settings file the package manager lists (`~/.pi/agent/settings.json`, the same file the dashboard's bridge registrar writes). Project-scope rows SHALL never be flagged. Adding the flag SHALL NOT change how bundled status is computed. All other rows SHALL omit the field or carry `false`. Matching SHALL compare canonical absolute paths (`~` expanded, resolved, symlinks followed when the file exists), so `~`-prefixed, relative and symlinked spellings of the same file match. The flag SHALL NOT change the row's `source`, `scope` or any other field, and SHALL NOT change what pi loads.

#### Scenario: Bridge path recorded by the dashboard
- **GIVEN** the managed-bridge registry maps `dashboard-goal` to `/repo/packages/goal-plugin/src/bridge/index.ts`
- **AND** `packages[]` contains that path as a plain string
- **WHEN** installed rows are enriched
- **THEN** that row SHALL carry `dashboardManaged: true`

#### Scenario: Unrelated local package
- **GIVEN** `packages[]` contains `/repo/packages/eng-disciplines`, which is not in the managed-bridge registry
- **WHEN** installed rows are enriched
- **THEN** that row SHALL NOT carry `dashboardManaged: true`

#### Scenario: Registry missing or unreadable
- **WHEN** the settings file has neither `dashboardPluginBridges` nor `_dashboardManagedPackages`
- **THEN** no row SHALL carry `dashboardManaged: true`
- **AND** enrichment SHALL NOT fail

#### Scenario: Only the ownership map records the path
- **GIVEN** `_dashboardManagedPackages` has the bridge path as a key but `dashboardPluginBridges` lacks it
- **WHEN** installed rows are enriched
- **THEN** that row SHALL carry `dashboardManaged: true`
