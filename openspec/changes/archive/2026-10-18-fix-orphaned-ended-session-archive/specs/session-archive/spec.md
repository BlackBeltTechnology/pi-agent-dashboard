## ADDED Requirements

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
