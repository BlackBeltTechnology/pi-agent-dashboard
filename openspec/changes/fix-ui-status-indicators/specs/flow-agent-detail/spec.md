## MODIFIED Requirements

### Requirement: Agent detail header shows agent metadata
The agent detail header SHALL show the agent name, status, model role, token usage, cost, and duration.

#### Scenario: Running agent header
- **WHEN** viewing detail for a running agent
- **THEN** the header SHALL show the agent name, a running indicator, and model role

#### Scenario: Complete agent header
- **WHEN** viewing detail for a completed agent
- **THEN** the header SHALL show agent name, ✓ status, tokens (↓in ↑out), and duration
- **AND** when the agent's `cost` is present and greater than `0`, the header SHALL show a `$`-prefixed cost value

#### Scenario: Complete agent header without cost
- **WHEN** viewing detail for a completed agent whose `cost` is absent or `0`
- **THEN** the header SHALL show tokens and duration and SHALL omit the cost value
