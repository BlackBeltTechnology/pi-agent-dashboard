## MODIFIED Requirements

### Requirement: Session discovery by filesystem scan
The system SHALL discover sessions at startup by scanning all subdirectories under `~/.pi/agent/sessions/`. For each `.meta.json` file with a corresponding `.jsonl` file, the system SHALL restore the session from cached data — unless the meta carries `archived: true`, in which case the system SHALL only add the session to the in-memory archive index (keyed by its resolved group path) and SHALL NOT restore it into the live set nor read its `.jsonl`. Folder history discovery from `.jsonl` headers (distinct from the startup scan) — after the startup scan, when a folder is pinned, and when the first resident session registers in a folder — SHALL skip any id that is resident, present in the archive index, or already backed by a `.meta.json`, and SHALL NOT write a `.meta.json` for a session it seeds.

#### Scenario: Startup with cached meta files
- **WHEN** the server starts and `.meta.json` files exist with cached stats
- **THEN** sessions SHALL be restored from `.meta.json` without parsing `.jsonl` files

#### Scenario: Archived meta is counted, not restored
- **WHEN** the server starts and a `.meta.json` has `archived: true`
- **THEN** the session SHALL NOT be restored into the live set, its `.jsonl` SHALL NOT be opened, and it SHALL be present in the archive index under its group path

#### Scenario: Pinned-dir discovery does not resurrect archived sessions
- **WHEN** a pinned directory's `.jsonl` header scan finds a session id that is in the archive index
- **THEN** that session SHALL NOT be restored into the live set

#### Scenario: First session in a folder does not resurrect archived sessions
- **GIVEN** a folder whose sessions are all archived, so no session with that cwd is resident
- **WHEN** a new session registers with that cwd
- **THEN** no archived session of that folder SHALL be restored into the live set, no `session_added` SHALL be broadcast for it, and the folder's archived count SHALL be unchanged

#### Scenario: Discovery never rewrites a discovered session's sidecar
- **GIVEN** a non-resident, non-archived session whose `.meta.json` exists
- **WHEN** its folder is pinned or a first session registers in that folder
- **THEN** it SHALL NOT be seeded into the live set from its `.jsonl` header and its `.meta.json` SHALL be byte-identical before and after

#### Scenario: Pinning a folder does not resurrect archived sessions
- **GIVEN** a folder with an archived session and no resident session
- **WHEN** the folder is pinned
- **THEN** the archived session SHALL NOT be restored into the live set and no `session_added` SHALL be broadcast for it

#### Scenario: Session file without meta file
- **WHEN** the server starts and a `.jsonl` file exists without a corresponding `.meta.json`
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
