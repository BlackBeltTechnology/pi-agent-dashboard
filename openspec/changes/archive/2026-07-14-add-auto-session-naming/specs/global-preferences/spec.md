## ADDED Requirements

### Requirement: Auto-name toggle persisted in preferences
The system SHALL persist a global boolean `autoNameSessions` in `preferences.json`, defaulting to `true` when absent. The value SHALL be read on startup and relayed to bridge extensions so they gate auto-naming on it.

#### Scenario: Default when absent
- **WHEN** `preferences.json` has no `autoNameSessions` field
- **THEN** the system SHALL treat it as `true`

#### Scenario: Toggle persisted
- **WHEN** the user toggles auto-naming in the Settings panel
- **THEN** the new value SHALL be written to `autoNameSessions` in `preferences.json`

#### Scenario: Relayed to bridges
- **WHEN** `autoNameSessions` is loaded or changed
- **THEN** the value SHALL be relayed to connected bridge extensions via config push
