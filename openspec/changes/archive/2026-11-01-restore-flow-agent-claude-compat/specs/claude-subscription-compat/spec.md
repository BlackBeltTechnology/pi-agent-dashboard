## MODIFIED Requirements

### Requirement: Flow agents receive the same rewrite
Every pi instance the dashboard extension loads into SHALL receive the docs-section rewrite under the same conditions, judged on that instance's own model and the switch value its process last received from the server: the main session and subagent children. Agents spawned by pi-flows, which do not load the settings packages, SHALL receive the same rewrite through pi-flows' agent-extension registration, announced by the flows plugin, judged on the agent's own model and the process's switch value.

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

#### Scenario: Factory survives a pi-flows re-seed
- **WHEN** the parent session starts again (for example after `/reload`)
- **THEN** the flows plugin SHALL announce the same factory again, so flow agents keep the rewrite without duplicates
