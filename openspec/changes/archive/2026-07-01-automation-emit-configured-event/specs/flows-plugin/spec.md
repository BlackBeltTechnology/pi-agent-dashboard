## MODIFIED Requirements

### Requirement: Flows registers automation actions

The flows plugin SHALL register `flows.run` as an automation action that dispatches by **emitting a configured event** into the run session (not by seeding a slash-command prompt), gated on flows existing in the cwd. `flows.run` SHALL declare a `flow` enum field (options = flows discovered in the cwd) and a `task` multiline field. Its `buildEvent` SHALL return `{ eventType: "flow:run", data: { flowName, task } }`; a malformed `flow` id SHALL emit nothing (`null`). The run SHALL finalize on `agent_end`.

The flows plugin SHALL NOT register `flows.resume` or `flows.cancel` — pi-flows exposes no run-scoped resume/cancel command reachable by the automation dispatch path. Registration SHALL be a no-op (with a warning) when the action registry is absent, and SHALL honor the registry's rejection result.

#### Scenario: flows.run emits flow:run

- **WHEN** `flows.run` fires with `payload { flow: "test:x", task: "go" }`
- **THEN** its `buildEvent` SHALL return `{ eventType: "flow:run", data: { flowName: "test:x", task: "go" } }`.

#### Scenario: malformed flow id emits nothing

- **WHEN** `flows.run` fires with a `flow` payload that is not `<ns>:<name>`
- **THEN** its `buildEvent` SHALL return `null` and no event SHALL be emitted.

#### Scenario: resume and cancel are not offered

- **WHEN** the flows plugin registers its actions
- **THEN** neither `flows.resume` nor `flows.cancel` SHALL be present in the registry.
