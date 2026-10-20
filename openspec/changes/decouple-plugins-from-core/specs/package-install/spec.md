## ADDED Requirements

### Requirement: Successful package operations refresh plugin discovery

When a package operation (`install`, `remove`, `update`) completes with `success: true` and a non-local scope, the server's package-operation completion listener SHALL invoke `refreshPluginDiscovery()` after broadcasting `package_operation_complete`. The HTTP routes SHALL NOT trigger the refresh, because they return before the operation completes.

The refresh SHALL run even when the package has no plugin manifest. In that case the resulting snapshot is unchanged.

#### Scenario: Plugin install triggers refresh and broadcast
- **WHEN** a global install of a package declaring `pi-dashboard-plugin` completes successfully
- **THEN** discovery SHALL be refreshed, the plugin's enabled server entry SHALL be loaded unless its `pi-package` source still lacks a server-trust grant (`dashboard-plugin-loader`), and one `plugins_changed` SHALL be broadcast

#### Scenario: Failed operation does not refresh
- **WHEN** an operation completes with `success: false`
- **THEN** plugin discovery SHALL NOT be refreshed and no `plugins_changed` SHALL be broadcast

### Requirement: Successful local-scope operations rerun local plugin detection

When an operation with `scope: "local"` completes with `success: true`, the listener SHALL NOT refresh discovery; it SHALL rerun local-scope plugin detection only and broadcast one `plugins_changed`.

#### Scenario: Local-scope operation reruns local detection only
- **WHEN** an operation with `scope: "local"` installing a manifest-bearing package into an active session's cwd completes successfully
- **THEN** plugin discovery SHALL NOT be refreshed and no server entry SHALL load
- **AND** one `plugins_changed` SHALL carry the package's `local-detected` row

### Requirement: Updating or removing a loaded plugin reports restartRequired

When a refresh follows a successful `update` or `remove` of a package whose plugin server entry is already loaded, that plugin's status SHALL carry `restartRequired: true` until the server restarts. A plugin installed for the first time SHALL NOT be marked restart-required.

#### Scenario: Update of a loaded plugin
- **WHEN** a loaded plugin is updated through `POST /api/packages/update` and the operation succeeds
- **THEN** the next `plugins_changed` snapshot SHALL contain the plugin with `restartRequired: true`

#### Scenario: First install
- **WHEN** a plugin is installed for the first time
- **THEN** its status SHALL NOT carry `restartRequired: true`
