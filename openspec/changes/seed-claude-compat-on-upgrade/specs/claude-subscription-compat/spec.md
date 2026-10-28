## MODIFIED Requirements

### Requirement: Global compat switch defaults to off
The system SHALL keep a global boolean Claude subscription compat switch. When no value has been stored, the dashboard SHALL seed it once at server start from the user's existing credentials: on when pi's `auth.json` holds an `anthropic` credential of any type, off when it holds none. The seeded value SHALL be stored, so the seed runs at most once and never replaces a stored value. When the credential state cannot be determined, the switch SHALL be treated as off and SHALL stay unstored. Its value SHALL survive a dashboard server restart.

#### Scenario: Default when never set
- **WHEN** the dashboard starts, no compat value has ever been stored, and `auth.json` has no `anthropic` credential
- **THEN** the switch SHALL read as off and off SHALL be stored
- **AND** the dashboard SHALL NOT rewrite any session's system prompt

#### Scenario: Upgrade with an existing Anthropic credential
- **WHEN** the dashboard starts, no compat value has ever been stored, and `auth.json` holds an `anthropic` credential (OAuth or API key)
- **THEN** the switch SHALL read as on and on SHALL be stored

#### Scenario: Stored value is never re-seeded
- **WHEN** the dashboard starts with a stored compat value of off and `auth.json` holds an `anthropic` credential
- **THEN** the switch SHALL read as off

#### Scenario: Credential state unknown
- **WHEN** the dashboard starts, no compat value has ever been stored, and `auth.json` cannot be parsed
- **THEN** the switch SHALL read as off
- **AND** no compat value SHALL be stored

#### Scenario: Persisted across restart
- **WHEN** the user turns the switch on and the dashboard server restarts
- **THEN** the switch SHALL read as on after the restart
