## ADDED Requirements

### Requirement: GET /api/sessions/:sessionId/entry/:entryId

The dashboard server SHALL expose `GET /api/sessions/:sessionId/entry/:entryId` returning the
full structured payload of a persisted custom entry for that session. This endpoint exists so
the UI can fetch the complete payload on demand when the rendered body was capped to its last N
lines, mirroring the on-demand `tool-result` endpoint.

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

- **WHEN** the requested `entryId` is unknown to the session, or has been evicted under memory
  pressure
- **THEN** the response SHALL be `404`

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
