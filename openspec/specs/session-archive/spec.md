# session-archive Specification

## Purpose
Defines the `archived` state for ended sessions: what may be archived, how archive and restore are requested, how the transition is persisted and broadcast, and the invariant that archived sessions are never resident in the live session set or shipped to browsers as part of it.

## Requirements

### Requirement: Archived is a persisted flag orthogonal to hidden

A session SHALL carry an optional `archived` state persisted in its `.meta.json` sidecar as `archived: boolean`, `archivedAt: number` (epoch ms) and `restoredAt: number` (epoch ms). The same three fields SHALL exist on `DashboardSession` and SHALL be included in the debounced full-overwrite meta serialisation, and the debounced writer SHALL carry them forward from disk when the in-memory session does not set them, so no routine meta write can drop them. `archived` SHALL be independent of `hidden`: `hidden` describes auto-hidden headless workers; `archived` describes ended sessions removed from the live set. All three fields SHALL be optional; a sidecar without them SHALL be read as not archived.

#### Scenario: Meta without archive fields
- **WHEN** a `.meta.json` contains no `archived` field
- **THEN** the session SHALL be treated as `archived = false`

#### Scenario: Archive fields survive unrelated meta writes
- **WHEN** a session with `archived: true, archivedAt: T` receives an unrelated meta update (e.g. a rename)
- **THEN** the sidecar SHALL still contain `archived: true, archivedAt: T` after the write

#### Scenario: restoredAt survives resident writes
- **WHEN** a restored resident session with `restoredAt: R` receives a debounced stats write
- **THEN** the sidecar SHALL still contain `restoredAt: R`

#### Scenario: Queued debounced write cannot clobber an archive
- **WHEN** a debounced meta write is pending for a session and the session is archived
- **THEN** the pending write SHALL be flushed before the eager archive write and the sidecar SHALL contain both the pending fields and `archived: true` afterwards

### Requirement: Only ended sessions can be archived

The server SHALL archive a session only when its status is `ended` and `live !== true`. An archive request for a running session SHALL be rejected with an error reply (WS) / 409 (REST). An archive request for an idle alive session SHALL register a one-shot archive intent that expires after 60 s and is cleared when the session is resumed or starts a turn, end the session, and archive it when its status becomes `ended` while the intent is still pending.

#### Scenario: Archive an ended session
- **WHEN** an archive request targets a session with status `ended`
- **THEN** the server SHALL mark it `archived = true`, set `archivedAt = now`, and persist the sidecar

#### Scenario: Archive a running session is rejected
- **WHEN** an archive request targets a session that is alive and currently running a turn
- **THEN** the server SHALL respond with an error and SHALL NOT change the session

#### Scenario: Archive an idle session ends it first
- **WHEN** an archive request targets an alive session that is idle
- **THEN** the server SHALL end the session, and once ended SHALL archive it

#### Scenario: Idle-archive intent expires
- **WHEN** an archive intent was registered for an idle session and 60 s pass without the session reaching `ended`
- **THEN** the intent SHALL be discarded and a later `ended` transition SHALL NOT archive the session

#### Scenario: Resume cancels a pending intent
- **WHEN** an archive intent is pending and the session is resumed or starts a turn before ending
- **THEN** the intent SHALL be discarded

#### Scenario: Interrupted session is never archived
- **WHEN** an archive request or sweep targets a session whose meta has `live: true`
- **THEN** the session SHALL NOT be archived

### Requirement: Archived sessions are not resident

An archived session SHALL NOT be present in the server's live session set, SHALL NOT appear in the `sessions` array of `sessions_snapshot` or in `GET /api/sessions`, and SHALL NOT be the subject of `session_added` or `session_updated` broadcasts. Clients SHALL NOT hold archived sessions in their live `sessions` state.

#### Scenario: Snapshot excludes archived
- **WHEN** a browser connects while 300 sessions are archived and 20 are not
- **THEN** `sessions_snapshot.sessions` SHALL contain the 20 non-archived sessions only

#### Scenario: Archive evicts from every connected client
- **WHEN** a session transitions to archived
- **THEN** the server SHALL broadcast `session_archived { sessionId, cwd, count }` to all browsers
- **AND** each client SHALL delete the id from its `sessions` state and set the folder's archived count

#### Scenario: session_removed semantics unchanged
- **WHEN** a client receives `session_removed` for a resident session
- **THEN** the session SHALL remain in `sessions` with status `ended` (existing behaviour); only `session_archived` deletes

### Requirement: Manual archive and restore verbs

The browser protocol SHALL provide `archive_session { sessionId }` and `unarchive_session { sessionId }` messages, and the HTTP API SHALL expose `POST /api/session/:id/archive` and `POST /api/session/:id/unarchive`, both responding `{ success: true }` on success. Restoring SHALL set `restoredAt = now`, clear `archived`, set `hidden = false`, re-add the session to the live set with status `ended`, and broadcast `session_added` and `archived_count_updated`. For an alive idle session the archive request SHALL respond `{ success: true, pending: true }` and the archive completes on the `ended` transition.

#### Scenario: Restore an archived session
- **WHEN** `unarchive_session` is received for an archived session
- **THEN** the server SHALL set `archived = false`, `restoredAt = now`, `hidden = false`, add the session back to the live set as `ended`, and broadcast `session_added`
- **AND** the session SHALL appear under its folder's ended group in every browser with `Show hidden` off

#### Scenario: Restore a migrated (hidden) session is visible
- **WHEN** `unarchive_session` targets a session whose sidecar still has `hidden: true` from migration
- **THEN** the restored session SHALL have `hidden = false`

#### Scenario: Restore an unknown id
- **WHEN** `unarchive_session` is received for an id with no archived sidecar
- **THEN** the server SHALL respond with an error and broadcast nothing

#### Scenario: REST archive
- **WHEN** `POST /api/session/:id/archive` is received for an ended session
- **THEN** the server SHALL archive it and respond `{ success: true }`

### Requirement: Session card archive affordance

A session card SHALL show an archive button when the session is `ended` or alive-but-idle, and SHALL NOT show it while the session is running a turn. For an ended session, clicking it SHALL send `archive_session` immediately. For an alive idle session, clicking it SHALL open a confirmation dialog stating the session will be ended, and SHALL send `archive_session` only on confirm. The per-card hide/unhide buttons SHALL NOT be rendered.

#### Scenario: Ended card shows archive
- **WHEN** a card renders for an ended session
- **THEN** it SHALL show the archive button and SHALL NOT show a hide button

#### Scenario: Running card hides archive
- **WHEN** a card renders for a session currently running a turn
- **THEN** it SHALL NOT show the archive button

#### Scenario: Idle card shows archive
- **WHEN** a card renders for an alive session that is idle
- **THEN** it SHALL show the archive button

#### Scenario: Idle archive asks for confirmation
- **WHEN** the user clicks archive on an alive idle session
- **THEN** a confirmation dialog SHALL appear and `archive_session` SHALL be sent only after confirm

#### Scenario: Ended archive needs no confirmation
- **WHEN** the user clicks archive on an ended session
- **THEN** `archive_session` SHALL be sent without a dialog

### Requirement: Boot migration of ended hidden sessions

On startup, for every discovered session whose sidecar has `hidden: true`, `live !== true` (any persisted status — a clean server stop leaves it non-`ended`) and no `archived` field, the server SHALL rewrite the sidecar once to `archived: true`, `archivedAt = endedAt ?? file mtime`, leaving `hidden` untouched so a rolled-back server still treats them as hidden. Alive sessions with `hidden: true` SHALL keep `hidden` and SHALL NOT be archived. Discovered history sessions (no bridge, ended) that are not archived SHALL be seeded as visible ended sessions, not hidden.

#### Scenario: Ended hidden becomes archived
- **WHEN** the server boots and finds a sidecar with `hidden: true`, `live` absent or `false`, and no `archived` field
- **THEN** it SHALL persist `archived: true`, keep `hidden: true`, and not load the session into the live set

#### Scenario: Alive hidden worker keeps hidden
- **WHEN** the server boots and a live bridge re-registers a session whose sidecar has `hidden: true`
- **THEN** the session SHALL remain `hidden: true` and not be archived

#### Scenario: Young discovered history is visible
- **WHEN** the server boots and finds an ended session sidecar younger than the archive threshold with no `hidden` and no `archived`
- **THEN** it SHALL be seeded as an ended session with `hidden = false`

#### Scenario: Migration is one-shot
- **WHEN** the server boots a second time after migration
- **THEN** no sidecar SHALL be rewritten by the migration step

### Requirement: Fileless ended sessions are archivable by eviction

A manual archive request (WS `archive_session` or REST `POST /api/session/:id/archive`) that targets a resident session with status `ended`, `live !== true`, and no `sessionFile` SHALL succeed. The server SHALL remove the session from the live set and broadcast `session_archived { sessionId, cwd, count }`, where `count` is the folder's current archived count, unchanged. The server SHALL NOT write any sidecar and SHALL NOT insert an archived-index row, because no transcript exists to list or restore. Archive requests for sessions *with* a `sessionFile` keep the existing persist-and-index behaviour. This requirement is an explicit exception to the "Archive an ended session" scenario and to "Archived is a persisted flag orthogonal to hidden". For a fileless session, `session_archived` signals eviction, not a persisted `archived` flag. Automatic archiving (sweep, service-end, migration) SHALL NOT evict a fileless session. It keeps rejecting it as before. These eviction guarantees apply to the running server. Cold-start hydration of a transcript file is unchanged.

#### Scenario: Archive an ended session with no session file
- **WHEN** `archive_session` targets a resident session with `status = "ended"`, `live !== true`, and `sessionFile` undefined
- **THEN** the server SHALL remove the session from the live set
- **AND** broadcast `session_archived` for it with the folder's unchanged archived count
- **AND** reply `{ success: true }` on REST, with no WS error reply

#### Scenario: Evicted fileless session is not listed as archived
- **WHEN** a fileless ended session has been archived by eviction
- **THEN** `GET /api/sessions/archived` SHALL NOT contain its id
- **AND** `unarchive_session` for its id SHALL respond with the existing "session is not archived" error

#### Scenario: Fileless eviction writes nothing to disk
- **WHEN** a fileless ended session is archived by eviction
- **THEN** no `.meta.json` file SHALL be created or modified

#### Scenario: Sweeper does not evict a fileless session
- **WHEN** the archive sweep or a service-end archive targets an ended, non-live session with no `sessionFile`
- **THEN** the session SHALL stay resident and no `session_archived` SHALL be broadcast for it

#### Scenario: Fileless interrupted session is still refused
- **WHEN** an archive request targets a fileless session whose `live` is `true`
- **THEN** the request SHALL be rejected with the existing "session is live (interrupted)" error and the session SHALL stay resident

### Requirement: WS archive rejections are reported to the requester

When a browser `archive_session` request is rejected for any reason (not found, running, live/interrupted, archive unavailable, persist failure), the server SHALL send `archive_session_error { sessionId, error }` to the requesting browser socket only. It SHALL NOT broadcast the error. The client SHALL show the `error` text as an error toast. A successful or pending (idle-alive) archive SHALL NOT produce `archive_session_error`.

#### Scenario: Rejected archive replies to the sender
- **WHEN** a browser sends `archive_session` for a session that is currently streaming
- **THEN** that browser SHALL receive `archive_session_error` with the session id and the "session is running" error
- **AND** no other connected browser SHALL receive it

#### Scenario: Unknown session id
- **WHEN** a browser sends `archive_session` for an id not in the live set
- **THEN** that browser SHALL receive `archive_session_error` with the "session not found" error

#### Scenario: Client surfaces the error
- **WHEN** the client receives `archive_session_error`
- **THEN** it SHALL show an error toast containing the `error` text, and the session card SHALL remain unchanged

#### Scenario: Success sends no error
- **WHEN** an archive request succeeds or is accepted as pending
- **THEN** the server SHALL NOT send `archive_session_error`
