## ADDED Requirements

### Requirement: Session archive/unarchive REST endpoints
The dashboard server SHALL expose `POST /api/session/:id/archive` and `POST /api/session/:id/unarchive` endpoints.

#### Scenario: Archive session
- **WHEN** a `POST /api/session/:id/archive` request is received for an ended session
- **THEN** the server SHALL mark the session archived, remove it from the live set, and respond with `{ success: true }`

#### Scenario: Archive an idle alive session
- **WHEN** a `POST /api/session/:id/archive` request is received for an alive idle session
- **THEN** the server SHALL end the session, respond `{ success: true, pending: true }`, and archive it once ended

#### Scenario: Archive a running session
- **WHEN** a `POST /api/session/:id/archive` request is received for a session running a turn
- **THEN** the server SHALL respond with `{ success: false, error }` and a 409 status

#### Scenario: Archive an interrupted session
- **WHEN** a `POST /api/session/:id/archive` request is received for a session with `live === true`
- **THEN** the server SHALL respond with `{ success: false, error }` and a 409 status

#### Scenario: Unarchive session
- **WHEN** a `POST /api/session/:id/unarchive` request is received for an archived session
- **THEN** the server SHALL restore the session into the live set as ended and respond with `{ success: true }`

### Requirement: Archived session delete endpoint
The dashboard server SHALL expose `DELETE /api/sessions/archived/:id`. For an archived session it SHALL remove the `.jsonl` and `.meta.json`, remove the index row, broadcast `archived_count_updated`, and respond `{ success: true }`. For a resident or unknown id it SHALL respond 404.

#### Scenario: Delete archived
- **WHEN** `DELETE /api/sessions/archived/:id` is received for an archived session
- **THEN** both files SHALL be gone and the response SHALL be `{ success: true }`

#### Scenario: Delete resident is refused
- **WHEN** `DELETE /api/sessions/archived/:id` is received for a resident session
- **THEN** the server SHALL respond 404 and delete nothing

### Requirement: Session list excludes archived sessions
`GET /api/sessions` SHALL return resident sessions only; archived sessions are available through `GET /api/sessions/archived`.

#### Scenario: Archived not in list
- **WHEN** `GET /api/sessions` is requested while a session is archived
- **THEN** that session SHALL NOT be in `data`

## REMOVED Requirements

### Requirement: Session hide/unhide REST endpoints
**Reason**: Manual hide is replaced by archive; `hidden` is now set only by the server-side auto-hide heuristic.
**Migration**: Call `POST /api/session/:id/archive` / `POST /api/session/:id/unarchive` instead.
