## MODIFIED Requirements

### Requirement: Session discovery by filesystem scan
The system SHALL discover sessions at startup by scanning all subdirectories under `~/.pi/agent/sessions/`. For each `.meta.json` file with a corresponding `.jsonl` file, the system SHALL restore the session from cached data — unless the meta carries `archived: true`, in which case the system SHALL only add the session to the in-memory archive index (keyed by its resolved group path) and SHALL NOT restore it into the live set nor read its `.jsonl`. The pinned-directory `.jsonl` header discovery SHALL likewise skip any id present in the archive index.

#### Scenario: Startup with cached meta files
- **WHEN** the server starts and `.meta.json` files exist with cached stats
- **THEN** sessions SHALL be restored from `.meta.json` without parsing `.jsonl` files

#### Scenario: Archived meta is counted, not restored
- **WHEN** the server starts and a `.meta.json` has `archived: true`
- **THEN** the session SHALL NOT be restored into the live set, its `.jsonl` SHALL NOT be opened, and it SHALL be present in the archive index under its group path

#### Scenario: Pinned-dir discovery does not resurrect archived sessions
- **WHEN** a pinned directory's `.jsonl` header scan finds a session id that is in the archive index
- **THEN** that session SHALL NOT be restored into the live set

#### Scenario: Session file without meta file
- **WHEN** a `.jsonl` file exists without a corresponding `.meta.json`
- **THEN** the system SHALL read the `.jsonl` header for session identity (id, cwd) and optionally extract stats, then write a `.meta.json` for future startups

#### Scenario: Orphaned meta file without session file
- **WHEN** a `.meta.json` file exists without a corresponding `.jsonl` file
- **THEN** the system SHALL ignore the orphaned `.meta.json`

#### Scenario: All directories scanned regardless of pin status
- **WHEN** the server starts
- **THEN** the system SHALL scan all directories under `~/.pi/agent/sessions/`, not just pinned directories

#### Scenario: Bridge reconnects after restart
- **WHEN** a session is restored from `.meta.json` and the bridge later reconnects with the same session ID
- **THEN** the bridge registration SHALL overwrite the stale cached entry with live data

## ADDED Requirements

### Requirement: Sidecar persists archive fields
The sidecar SHALL accept optional `archived: boolean`, `archivedAt: number` and `restoredAt: number` fields, written through the eager, synchronous atomic write path (the one the liveness marker uses), bypassing the debounced meta cache so the sidecar is durable before the session leaves the live set.

#### Scenario: Archive fields round-trip
- **WHEN** a session is archived and the server restarts
- **THEN** the sidecar read at boot SHALL contain `archived: true` and the original `archivedAt`
