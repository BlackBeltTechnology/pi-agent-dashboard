## ADDED Requirements

### Requirement: flow_agent_error event handling owned by flows-plugin
The plugin's reducer SHALL handle `flow_agent_error` by appending an `{ kind: "error", text }` entry to the targeted agent's `detailHistory` array, locating the agent by `agentName`/`stepId`. The `error` variant of `FlowDetailEntry` already exists; this requirement adds its producer case. The reducer SHALL NOT change the agent's status (status is owned by `flow_agent_complete`). Events with empty `text` SHALL be ignored.

#### Scenario: Agent error recorded in timeline
- **WHEN** a `flow_agent_error` event with `{ agentName: "researcher", stepId: "research", text: "tool quota exceeded" }` is processed
- **THEN** the agent's `detailHistory` SHALL include an `{ kind: "error", text: "tool quota exceeded" }` entry

#### Scenario: Empty error text ignored
- **WHEN** a `flow_agent_error` event with empty `text` is processed
- **THEN** the agent's `detailHistory` SHALL be unchanged

#### Scenario: Error replays identically from persisted entries
- **WHEN** a persisted `flow-event` record with `eventType: "flow_agent_error"` is replayed on reload
- **THEN** the reducer SHALL rebuild the same `{ kind: "error", text }` timeline entry as the live path produced
