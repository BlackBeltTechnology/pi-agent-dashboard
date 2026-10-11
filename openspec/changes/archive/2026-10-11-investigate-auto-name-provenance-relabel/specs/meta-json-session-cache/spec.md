## MODIFIED Requirements

### Requirement: Session name provenance in meta
`SessionMeta` SHALL include an optional `nameSource?: "auto" | "user" | "system"` field recording how the current session name was set, and an optional `nameSourceFor?: string` field recording the name an `auto` or `system` provenance was recorded for (its witness). Absent `nameSource` means no name has been set by any path. `"system"` means the dashboard set the name programmatically (attach auto-rename, trusted-plugin rename). `nameSourceFor` SHALL be absent whenever `nameSource` is absent or `"user"`. Both fields are dashboard-owned and drive the auto-naming lockout.

#### Scenario: Auto-named session records provenance
- **WHEN** the bridge auto-generates a session name
- **THEN** `nameSource` in the session's `.meta.json` SHALL be `"auto"` and `nameSourceFor` SHALL be that name

#### Scenario: User-named session records provenance
- **WHEN** a session name is set by a user-initiated dashboard rename or an in-pi rename
- **THEN** `nameSource` in the session's `.meta.json` SHALL be `"user"` and `nameSourceFor` SHALL be absent

#### Scenario: System-named session records provenance
- **WHEN** a session name is set programmatically by the dashboard
- **THEN** `nameSource` in the session's `.meta.json` SHALL be `"system"` and `nameSourceFor` SHALL be that name

#### Scenario: Field absent by default
- **WHEN** a session has never been named
- **THEN** `nameSource` and `nameSourceFor` SHALL be absent from `.meta.json`

#### Scenario: Provenance survives a restart
- **GIVEN** a session persisted with `nameSource = "auto"`
- **WHEN** the pi process restarts and the session reconnects without being renamed
- **THEN** `nameSource` in `.meta.json` SHALL still be `"auto"`

#### Scenario: Witness survives a full-overwrite save
- **GIVEN** a session with `nameSource = "system"` and `nameSourceFor = "add-x"`
- **WHEN** an unrelated field change triggers a full `.meta.json` save
- **THEN** `nameSourceFor` SHALL still be `"add-x"`

#### Scenario: Plain name update keeps the witness
- **GIVEN** a session with `nameSource = "auto"` and `nameSourceFor = "Fix login"`
- **WHEN** a name update without provenance arrives
- **THEN** `nameSourceFor` SHALL remain `"Fix login"`

#### Scenario: Row without a witness
- **GIVEN** a `.meta.json` with `nameSource = "auto"` and no `nameSourceFor`
- **WHEN** the session registers
- **THEN** no witness SHALL be assumed
