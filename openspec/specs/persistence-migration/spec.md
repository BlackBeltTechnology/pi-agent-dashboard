# persistence-migration Specification

## Purpose

Moves existing installations onto the current persistence layout automatically on first startup: session data into meta files, hidden state out of `state.json`, and global preferences into their new home. Requires old files to be renamed after migration and the whole migration to be idempotent, so an interrupted or repeated run cannot corrupt or duplicate data.

## Requirements

### Requirement: Automatic migration on first startup
The system SHALL automatically migrate from `sessions.json` + `state.json` to the new persistence model when old files are detected at server startup. Migration SHALL run before normal session restoration.

#### Scenario: Old files detected on startup
- **WHEN** the server starts and `~/.pi/dashboard/sessions.json` or `~/.pi/dashboard/state.json` exists
- **THEN** the system SHALL run migration before proceeding with normal startup

#### Scenario: No old files present
- **WHEN** the server starts and neither `sessions.json` nor `state.json` exists
- **THEN** the system SHALL skip migration and proceed with normal startup

### Requirement: Session data migrated to meta files
The migration SHALL read `sessions.json` and write a `.meta.json` sidecar for each session that has a valid `sessionFile` path pointing to an existing `.jsonl` file.

#### Scenario: Session with valid session file
- **WHEN** a session in `sessions.json` has a `sessionFile` pointing to an existing `.jsonl`
- **THEN** the migration SHALL write a `.meta.json` next to that `.jsonl` with all dashboard-owned fields and cached stats

#### Scenario: Session with missing or invalid session file
- **WHEN** a session in `sessions.json` has no `sessionFile` or points to a non-existent file
- **THEN** the migration SHALL skip that session (no `.meta.json` created)

#### Scenario: Existing meta file is merged not overwritten
- **WHEN** a `.meta.json` already exists for a session being migrated
- **THEN** the migration SHALL merge new fields into the existing file, preserving any fields already present

### Requirement: Hidden state migrated from state.json
The migration SHALL read `hiddenSessions` from `state.json` and set `hidden: true` in the corresponding `.meta.json` files.

#### Scenario: Hidden session with known session file
- **WHEN** a hidden session ID matches a session in `sessions.json` that has a valid `sessionFile`
- **THEN** the migration SHALL set `hidden: true` in that session's `.meta.json`

#### Scenario: Hidden session ID with no matching session
- **WHEN** a hidden session ID in `state.json` has no corresponding session in `sessions.json`
- **THEN** the migration SHALL attempt to find the `.jsonl` file by scanning `~/.pi/agent/sessions/` directories for a filename containing that UUID, and set `hidden: true` in the `.meta.json` if found

#### Scenario: Orphaned hidden session ID
- **WHEN** a hidden session ID cannot be matched to any `.jsonl` file
- **THEN** the migration SHALL skip that ID (it is garbage-collected by omission)

### Requirement: Global preferences migrated
The migration SHALL read `pinnedDirectories` and `sessionOrder` from `state.json` and write them to `~/.pi/dashboard/preferences.json`.

#### Scenario: Preferences migrated from state.json
- **WHEN** `state.json` contains `pinnedDirectories` and `sessionOrder`
- **THEN** the migration SHALL write both to `preferences.json`

#### Scenario: State.json missing preferences fields
- **WHEN** `state.json` exists but lacks `pinnedDirectories` or `sessionOrder`
- **THEN** the migration SHALL use empty defaults for missing fields

### Requirement: Old files renamed after migration
The migration SHALL rename old files to `.bak` after successful migration. This prevents re-migration on subsequent startups.

#### Scenario: Successful migration renames files
- **WHEN** migration completes successfully
- **THEN** `sessions.json` SHALL be renamed to `sessions.json.bak` and `state.json` SHALL be renamed to `state.json.bak`

#### Scenario: Only one old file exists
- **WHEN** only `sessions.json` exists (no `state.json`) or vice versa
- **THEN** the migration SHALL process the existing file and rename only that file to `.bak`

### Requirement: Migration is idempotent
The migration SHALL be safe to run multiple times. Re-running migration on already-migrated data SHALL not corrupt or duplicate data.

#### Scenario: Re-run after partial migration
- **WHEN** migration ran partially (some `.meta.json` written, old files not renamed)
- **THEN** re-running migration SHALL merge into existing `.meta.json` files without data loss

#### Scenario: Bak files are not re-processed
- **WHEN** the server starts and only `.bak` files exist (no `sessions.json` or `state.json`)
- **THEN** the migration SHALL not run
