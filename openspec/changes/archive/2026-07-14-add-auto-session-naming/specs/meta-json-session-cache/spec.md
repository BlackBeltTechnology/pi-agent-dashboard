## ADDED Requirements

### Requirement: Session name provenance in meta
`SessionMeta` SHALL include an optional `nameSource?: "auto" | "user"` field recording how the current session name was set. Absent means no name has been set by either path. The field is dashboard-owned and drives the auto-naming lockout.

#### Scenario: Auto-named session records provenance
- **WHEN** the bridge auto-generates a session name
- **THEN** `nameSource` in the session's `.meta.json` SHALL be `"auto"`

#### Scenario: User-named session records provenance
- **WHEN** a session name is set by a dashboard rename or an in-pi rename
- **THEN** `nameSource` in the session's `.meta.json` SHALL be `"user"`

#### Scenario: Field absent by default
- **WHEN** a session has never been named
- **THEN** `nameSource` SHALL be absent from `.meta.json`
