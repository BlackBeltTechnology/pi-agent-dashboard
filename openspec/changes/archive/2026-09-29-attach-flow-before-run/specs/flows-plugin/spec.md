## MODIFIED Requirements

### Requirement: flow_complete event handling owned by flows-plugin
The plugin's reducer SHALL update `flowState.status` to the result status and store the `FlowResult` data for the summary view when `flow_complete` is processed. A `flow_complete` whose status is `"rejected"` (a start the flow engine refused, emitted without any `flow_started`) SHALL NOT alter the current `flowState`: its status, agents, and result SHALL stay unchanged, and a running flow SHALL remain running.

#### Scenario: Flow completes
- **WHEN** a `flow_complete` event with `{ status: "success", flowName: "research", results: {...} }` is processed
- **THEN** `flowState.status` SHALL be `"success"` and `flowState.flowResult` SHALL contain the results

#### Scenario: Rejected start leaves a running flow running
- **GIVEN** flow `research` is running
- **WHEN** a `flow_complete` event with `{ status: "rejected", flowName: "research", reason: "A flow is already running" }` is processed
- **THEN** `flowState.status` SHALL still be `"running"` and no agent card status SHALL change

#### Scenario: Rejected start with no current flow
- **GIVEN** no flow state exists for the session
- **WHEN** a `flow_complete` event with `{ status: "rejected" }` is processed
- **THEN** no flow state SHALL be created
