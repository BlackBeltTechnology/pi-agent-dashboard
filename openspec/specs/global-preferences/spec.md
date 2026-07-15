## Purpose

Persist global, cross-session UI preferences in `preferences.json` (pinned directories, session order, feature toggles) — read on startup, written with debounced atomic writes, and never mixed with per-session state.
## Requirements
### Requirement: Global preferences stored in preferences.json
The system SHALL persist global UI preferences in `~/.pi/dashboard/preferences.json`. This file SHALL contain only cross-session/global state, not per-session data.

#### Scenario: Preferences file read on startup
- **WHEN** the server starts and `preferences.json` exists
- **THEN** the system SHALL load `pinnedDirectories` and `sessionOrder` from the file

#### Scenario: Preferences file missing
- **WHEN** the server starts and `preferences.json` does not exist
- **THEN** the system SHALL use empty defaults (no pinned directories, no session order)

#### Scenario: Preferences file malformed
- **WHEN** the server starts and `preferences.json` contains invalid JSON
- **THEN** the system SHALL use empty defaults

### Requirement: Pinned directories persisted in preferences
The system SHALL persist `pinnedDirectories` as a JSON array of directory paths in `preferences.json`.

#### Scenario: Pin a directory
- **WHEN** a user pins a directory
- **THEN** the directory SHALL be added to the `pinnedDirectories` array in `preferences.json`

#### Scenario: Unpin a directory
- **WHEN** a user unpins a directory
- **THEN** the directory SHALL be removed from the `pinnedDirectories` array in `preferences.json`

### Requirement: Session order persisted in preferences
The system SHALL persist `sessionOrder` as a JSON object mapping cwd paths to arrays of session IDs in `preferences.json`.

#### Scenario: Reorder sessions
- **WHEN** a user reorders sessions within a directory group
- **THEN** the new order SHALL be saved to `preferences.json`

### Requirement: Debounced atomic writes for preferences
The system SHALL debounce writes to `preferences.json` and use atomic write operations (write-to-temp + rename).

#### Scenario: Rapid preference changes
- **WHEN** multiple preference changes occur within the debounce window
- **THEN** only one write to `preferences.json` SHALL occur

#### Scenario: Server shutdown flushes preferences
- **WHEN** the server shuts down with pending preference changes
- **THEN** the system SHALL flush pending changes before exit

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

