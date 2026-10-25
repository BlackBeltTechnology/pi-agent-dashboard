## ADDED Requirements

### Requirement: MCP spawn_session forwards the full spawn input

The `spawn_session` MCP tool's input schema SHALL be generated from the shared `SpawnSessionRequest`: `cwd`, `agent`, `model`, `thinkingLevel`, `initialPrompt`. The handler SHALL forward every provided field to the host spawn hook. A `model` may be a `provider/id` or an `@role` reference. A dropped choice SHALL be reported in the tool result text.

#### Scenario: MCP spawn with a role
- **WHEN** an MCP client calls `spawn_session {cwd:"/p", model:"@review", initialPrompt:"go"}`
- **THEN** the host spawn hook SHALL receive `model: "@review"` and `initialPrompt: "go"`

#### Scenario: Agent is forwarded
- **WHEN** an MCP client calls `spawn_session {cwd:"/p", agent:"qmt"}`
- **THEN** the host spawn hook SHALL receive `agent: "qmt"`
