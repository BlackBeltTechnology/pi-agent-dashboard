# server-launch — delta

## ADDED Requirements

### Requirement: The Electron launch path SHALL carry the configured ceiling

An Electron-spawned dashboard server SHALL run under the configured ceiling and
SHALL NOT fall back to the runtime's own default. This is the third launch path
alongside the standalone wrapper and the bridge-initiated launch.

#### Scenario: Electron-spawned server is stamped
- **WHEN** the Electron shell launches the dashboard server
- **THEN** that server SHALL run under the ceiling configured in `~/.pi/dashboard/config.json`
- **AND** it SHALL NOT fall back to the runtime's own default

#### Scenario: Unreadable config falls back to the shared default
- **WHEN** the Electron shell launches the dashboard server and `~/.pi/dashboard/config.json` is absent or unparseable
- **THEN** the launcher SHALL stamp the shared default ceiling rather than failing the launch

#### Scenario: Operator-pinned environment still wins on the Electron path
- **WHEN** the Electron launch environment already carries an operator-set heap flag
- **THEN** the launcher SHALL NOT override it
- **AND** the launcher SHALL NOT add a higher-precedence argv flag that would outrank it

### Requirement: A restarted server SHALL keep the configured ceiling

A server respawned by `/api/restart` SHALL run under the configured ceiling and
SHALL NOT revert to the runtime's own default. This applies to every launch
path, since the respawn is a common exit from all of them.

The respawn SHALL read the ceiling from configuration at restart time, so a
`serverHeap` change takes effect on restart rather than requiring a cold start.

#### Scenario: Restart preserves the ceiling
- **WHEN** a server running under a configured ceiling is restarted via `/api/restart`
- **THEN** the respawned server SHALL run under the same configured ceiling

#### Scenario: Restart picks up a ceiling edited since boot
- **WHEN** `serverHeap.maxOldSpaceMb` is changed after the server booted and the server is restarted via `/api/restart`
- **THEN** the respawned server SHALL run under the NEW configured ceiling, not the booted one

#### Scenario: Restart does not duplicate an existing pin
- **WHEN** the restart respawn would re-apply a ceiling the environment already pins
- **THEN** the operator's pin SHALL remain in effect and SHALL NOT be shadowed by the re-stamp
