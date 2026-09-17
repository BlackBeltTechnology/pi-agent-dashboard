## ADDED Requirements

### Requirement: GET /api/sessions/:sessionId/entry/:entryId

The dashboard server SHALL expose `GET /api/sessions/:sessionId/entry/:entryId` returning the
full structured payload of a persisted custom entry for that session. This endpoint exists so
the UI can fetch the complete payload on demand when the rendered body was capped to its last N
lines.

The payload SHALL be read from the session's on-disk JSONL, resolved through the session manager
(never constructed from the `sessionId` string), mirroring the existing `session-change`
endpoint. The endpoint SHALL NOT source the payload from the in-memory event store, because that
store truncates string fields and collapses long arrays at INGEST and therefore cannot return an
untruncated payload — failing precisely for the large payloads this endpoint exists to serve.

The entry SHALL be addressed by session identifier, never by filesystem path, so the endpoint
cannot be used to read a file outside the addressed session. The route SHALL be guarded by the
same network guard used by other session routes.

#### Scenario: Custom entry returns full payload

- **WHEN** a session has persisted a custom entry with `entryId = "abc"` whose payload exceeds
  the chat display ceiling
- **AND** the client requests `GET /api/sessions/:sessionId/entry/abc`
- **THEN** the response SHALL be `200` with the entry's `customType` and its complete,
  untruncated structured payload

#### Scenario: Unknown or evicted entry

- **WHEN** the requested `entryId` is unknown to the session, or is absent from the session file
- **THEN** the response SHALL be `404`

#### Scenario: Entry not yet flushed to disk

- **GIVEN** the agent runtime buffers appended custom entries in memory and creates or extends
  the session file only once a subsequent assistant message is appended
- **WHEN** the client requests an entry that has not yet been flushed
- **THEN** the response SHALL be `404`, and the client SHALL degrade to the row's stored body
- **AND** this SHALL NOT be treated as an error condition, since a later request for the same
  entry succeeds once the flush occurs

#### Scenario: Entry on an abandoned branch

- **GIVEN** the session file records a branch structure and the requested entry lies outside the
  active leaf-to-root branch (for example before a rewind)
- **WHEN** the client requests it
- **THEN** the response SHALL be `404` and the client SHALL degrade to the row's stored body,
  since the on-disk reader resolves only the active branch

#### Scenario: Entry belongs to a different session

- **GIVEN** `entryId` identifies an entry persisted under a different session
- **WHEN** the client requests it under this `sessionId`
- **THEN** the response SHALL be `404`
- **AND** the other session's payload SHALL NOT be returned

#### Scenario: Traversal-shaped identifier is rejected

- **WHEN** the request supplies an `entryId` containing path separators or parent-directory
  segments
- **THEN** the response SHALL be `404` and no filesystem read outside the addressed session
  SHALL occur
