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

### Requirement: Flow agents receive the same rewrite
Every pi instance the dashboard extension loads into SHALL receive the docs-section rewrite under the same conditions, judged on that instance's own model and the switch value its process last received from the server: the main session, subagent children, and agents spawned by pi-flows that load the settings packages. No plugin or package SHALL need to register it.

#### Scenario: Flow agent on Anthropic
- **WHEN** the switch is on and a flow agent runs on an `anthropic` model
- **THEN** the flow agent's outbound system prompt SHALL NOT contain `pi itself` or `pi packages`

#### Scenario: Subagent on Anthropic
- **WHEN** the switch is on and a subagent child session runs on an `anthropic` model
- **THEN** the subagent's outbound system prompt SHALL NOT contain `pi itself` or `pi packages`

#### Scenario: Flow agent with switch off
- **WHEN** the switch is off and a flow agent runs on an `anthropic` model
- **THEN** the dashboard SHALL NOT rewrite the flow agent's docs section

#### Scenario: Flow agent on another provider
- **WHEN** the switch is on, the parent session runs on `anthropic`, and a flow agent runs on a non-`anthropic` model
- **THEN** the flow agent's docs section SHALL be sent unmodified

### Requirement: Anthropic row shows and controls the switch
The authenticated `anthropic` subscription row in Provider Authentication SHALL show whether the switch is on and SHALL offer a control that changes it. Changing it there SHALL have the same effect as changing it anywhere else. The control SHALL NOT gate sign-out, the Connected marker or the expiry display. The row SHALL NOT make the switch depend on any plugin.

#### Scenario: Off state visible
- **WHEN** the `anthropic` subscription row is authenticated and the switch is off
- **THEN** the row SHALL show that compat is off with a control to turn it on

#### Scenario: Flows plugin disabled
- **WHEN** the `anthropic` subscription row is authenticated and the Flows plugin is disabled
- **THEN** the row SHALL show the switch with no notice that it needs the Flows plugin

#### Scenario: Toggle from the row
- **WHEN** the user turns the switch on from the `anthropic` row
- **THEN** the switch SHALL be on and the next agent run on an `anthropic` model SHALL apply the rewrite

## ADDED Requirements

### Requirement: Rewrite covers the outgoing request's system text
While the switch is on and a request's model provider is `anthropic`, the dashboard SHALL apply the docs-section rewrite to the request's outgoing system text, only when that text holds exactly one pi docs block. Other system blocks, their cache settings and the messages SHALL stay unchanged.

#### Scenario: Session started before the switch was on
- **WHEN** a session whose first system prompt carries `pi itself` sends a request on an `anthropic` model with the switch on
- **THEN** the request's system text SHALL read `the cli itself` and `cli packages` and SHALL contain neither `pi itself` nor `pi packages`
- **AND** the request's other system blocks and messages SHALL be unchanged

#### Scenario: Nothing to rewrite
- **WHEN** the switch is off, the provider is not `anthropic`, or the system text holds zero or several pi docs blocks
- **THEN** the request SHALL be sent unchanged
