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

### Requirement: Collapsed folders persisted in preferences
The system SHALL persist `collapsedFolders` as a JSON array of canonicalized
directory paths in `preferences.json`, alongside `pinnedDirectories` and
`sessionOrder`. A path present in the array means that folder group is
collapsed; absence means expanded. The array SHALL be subject to the same
debounced atomic write behavior as the other preferences, and SHALL be
broadcast to connected browser clients whenever it changes, so that every open
dashboard converges on the same state.

#### Scenario: Collapse a folder
- **WHEN** a client reports a folder as collapsed
- **THEN** the canonicalized directory path SHALL be added to the `collapsedFolders` array in `preferences.json`

#### Scenario: Expand a folder
- **WHEN** a client reports a folder as expanded
- **THEN** the canonicalized directory path SHALL be removed from the `collapsedFolders` array in `preferences.json`

#### Scenario: Field absent in an existing preferences file
- **WHEN** the server starts and `preferences.json` exists but has no `collapsedFolders` field
- **THEN** the system SHALL treat it as an empty array rather than failing to load the file

#### Scenario: Change broadcast to open clients
- **WHEN** `collapsedFolders` changes
- **THEN** the updated array SHALL be broadcast to connected browser clients

#### Scenario: Delivered on connect
- **WHEN** a browser client connects
- **THEN** the current `collapsedFolders` array SHALL be delivered to that client as part of its initial state, without waiting for a subsequent change

#### Scenario: Paths stored as given, not symlink-resolved
- **WHEN** a collapsed folder path is stored or read back
- **THEN** it SHALL be normalized only by the shared path-key rule and SHALL NOT be symlink-resolved, so that it still matches the path a client can compute locally
