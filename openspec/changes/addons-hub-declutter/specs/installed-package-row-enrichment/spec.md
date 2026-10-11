## ADDED Requirements

### Requirement: Flag dashboard-managed bridge entries

The system SHALL set `dashboardManaged: true` on an installed-package row when its resolved path equals a bridge path the dashboard recorded for a plugin (the values of the managed-bridge registry in the same settings file). All other rows SHALL omit the field or carry `false`. Matching SHALL compare resolved absolute paths, so `~`-prefixed and relative spellings of the same file match. The flag SHALL NOT change the row's `source`, `scope` or any other field, and SHALL NOT change what pi loads.

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
- **WHEN** the settings file has no managed-bridge registry
- **THEN** no row SHALL carry `dashboardManaged: true`
- **AND** enrichment SHALL NOT fail
