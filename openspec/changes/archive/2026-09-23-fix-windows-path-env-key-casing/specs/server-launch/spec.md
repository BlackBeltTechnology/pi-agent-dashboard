## ADDED Requirements

### Requirement: Bridge auto-spawn passes only narrow env overrides
The bridge extension's server auto-spawn SHALL pass `launchDashboardServer` an `env` that holds only its own overrides, never a full copy of `process.env`. This complies with the existing env-merge contract, and keeps the PATH augmentation from `buildSpawnEnv` (managed dir, bundled node, bundled git) in the spawned server's env on every platform. The overrides are:
- `DASHBOARD_STARTER` = `Bridge`
- `NODE_OPTIONS` and its heap provenance marker, computed from the inherited values with the configured ceiling stamped in (an operator-pinned ceiling is still respected)
- JS `undefined` for `PI_DASHBOARD_ELECTRON` and `PI_DASHBOARD_RESOURCES_PATH`, so the overlay deletes them

#### Scenario: Bridge env overrides are narrow
- **WHEN** the bridge auto-spawns the server
- **THEN** the `env` passed to `launchDashboardServer` SHALL NOT contain `PATH`, `Path`, `HOME` or any other inherited key outside the override set
- **AND** it SHALL contain `DASHBOARD_STARTER` = `Bridge` and a `NODE_OPTIONS` carrying the configured `--max-old-space-size` ceiling

#### Scenario: Spawned server keeps the augmented PATH
- **WHEN** the bridge auto-spawns the server on any platform
- **THEN** the spawned server's env PATH SHALL equal the PATH produced by `buildSpawnEnv(process.env)`, with no raw process PATH overlaid on it

#### Scenario: Electron launcher markers are still stripped
- **WHEN** the bridge's process env carries `PI_DASHBOARD_ELECTRON` and `PI_DASHBOARD_RESOURCES_PATH`
- **THEN** the spawned server's env SHALL contain neither key

#### Scenario: Operator heap pin is respected
- **WHEN** the inherited `NODE_OPTIONS` already carries an operator-set `--max-old-space-size` that the dashboard did not stamp
- **THEN** the override `NODE_OPTIONS` SHALL keep the operator's value and SHALL NOT append the dashboard ceiling
