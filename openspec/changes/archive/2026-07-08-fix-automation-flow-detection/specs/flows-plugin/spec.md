## MODIFIED Requirements

### Requirement: Flows registers automation actions

The flows plugin SHALL register `flows.run` as an automation action that dispatches by **emitting a configured event** into the run session (not by seeding a slash-command prompt), gated on flows existing in the cwd. The set of "flows in the cwd" SHALL be the live per-session flows list held by the flows-plugin server (`stateStore`, populated by the bridge-forwarded `flows_list`), resolved by mapping the cwd to its running pi session(s) via the plugin `sessionManager` and unioning their reported flows. The gate SHALL NOT be a static filesystem scan of `<cwd>/.pi/flows/flows/`, so package-bundled and event-registered flows (which pi-flows discovers at runtime) are reflected. `flows.run` SHALL declare a `flow` enum field (options = the same live cwd flows list) and a `task` multiline field. Its `buildEvent` SHALL return `{ eventType: "flow:run", data: { flowName, task } }`; a malformed `flow` id SHALL emit nothing (`null`). The run SHALL finalize on `agent_end`.

When no running pi session exists for the cwd, the live flows list SHALL be empty and `flows.run` SHALL be reported as unavailable (present-but-disabled) for that cwd.

The flows plugin SHALL NOT register `flows.resume` or `flows.cancel` — pi-flows exposes no run-scoped resume/cancel command reachable by the automation dispatch path. Registration SHALL be a no-op (with a warning) when the action registry is absent, and SHALL honor the registry's rejection result.

#### Scenario: flows.run available from live session flows

- **WHEN** a pi session is running for cwd `/w/invoice-bot` and its forwarded `flows_list` contains `invoicebot:pull` (a package/event-registered flow not present under `<cwd>/.pi/flows/flows/`)
- **THEN** `available(cwd)` SHALL return true and the `flow` enum options SHALL include `invoicebot:pull`.

#### Scenario: flows.run unavailable with no live session

- **WHEN** no pi session is running for cwd `/w/invoice-bot`
- **THEN** `available(cwd)` SHALL return false and the dialog SHALL surface `flows.run` as present-but-disabled.

#### Scenario: flows.run emits flow:run

- **WHEN** `flows.run` fires with `payload { flow: "test:x", task: "go" }`
- **THEN** its `buildEvent` SHALL return `{ eventType: "flow:run", data: { flowName: "test:x", task: "go" } }`.

#### Scenario: malformed flow id emits nothing

- **WHEN** `flows.run` fires with a `flow` payload that is not `<ns>:<name>`
- **THEN** its `buildEvent` SHALL return `null` and no event SHALL be emitted.

#### Scenario: resume and cancel are not offered

- **WHEN** the flows plugin registers its actions
- **THEN** neither `flows.resume` nor `flows.cancel` SHALL be present in the registry.
