## MODIFIED Requirements

### Requirement: Server creates records for undiscovered sessions
When the server receives a `sessions_list` from the bridge, it SHALL create in-memory session records for any pi sessions not already in the session manager; each seeded record SHALL carry the reporting socket's `originDeviceId` (undefined for a hub-local socket).

#### Scenario: New session discovered from pi listing
- **WHEN** the `sessions_list` contains a session ID not present in the session manager
- **THEN** the server SHALL register a new record with: `id` = pi session ID, `cwd` from listing, `name` from listing, `sessionFile` = path from listing, then immediately unregister it (setting `status = "ended"`)
- **AND** the record SHALL carry the reporting socket's `originDeviceId`

#### Scenario: Existing session in listing
- **WHEN** the `sessions_list` contains a session ID already present in the session manager
- **THEN** the server SHALL NOT overwrite the existing record (dashboard data takes precedence)

#### Scenario: Session file path updated for existing session
- **WHEN** the `sessions_list` contains a known session ID but with a different `sessionFile`
- **AND** the reporter's origin equals the record's recorded origin; otherwise the record is unchanged
- **THEN** the server SHALL update the `sessionFile` and `sessionDir` fields (file may have been moved)

#### Scenario: Session file path not updated by another origin
- **WHEN** the `sessions_list` contains a known session ID with a different `sessionFile` from a socket whose origin differs from the record's recorded origin
- **THEN** the `sessionFile` and `sessionDir` SHALL be unchanged
