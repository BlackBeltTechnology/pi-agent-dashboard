## MODIFIED Requirements

### Requirement: Session rename REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/rename` endpoint that renames the specified session. The endpoint SHALL accept a JSON body with `name` (required string). A REST rename is a user-initiated rename: it SHALL record `nameSource = "user"` and clear the provenance witness, exactly like a dashboard UI rename. The rename forwarded to the pi session SHALL NOT carry `system` origin.

#### Scenario: Rename session
- **WHEN** a `POST /api/session/:id/rename` request is received with `{ "name": "my-session" }`
- **THEN** the server SHALL update the session name in the session manager, forward to the pi session, and respond with `{ success: true }`
- **AND** the session's `nameSource` SHALL be `"user"`

#### Scenario: Rename with no bridge connected still locks out
- **WHEN** a REST rename is received while no bridge is connected for the session
- **THEN** the session's `nameSource` SHALL be `"user"`
