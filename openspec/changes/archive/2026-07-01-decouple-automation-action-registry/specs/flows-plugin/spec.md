## MODIFIED Requirements

### Requirement: Flows registers automation actions

The flows plugin SHALL contribute its automation action by **publishing** an immutable contribution under `automation.action.flows` via `ctx.provide` in its `registerPlugin`. It SHALL NOT consume an automation-owned registry, SHALL NOT import or reference the automation plugin, and SHALL NOT declare `dependsOn: ["automation"]`. Flows loads and functions identically whether or not the automation plugin is present.

The published contribution SHALL declare `flows.run`: a `flow` enum field (options = flows discovered in the cwd) and a `task` multiline field, gated on flows existing in the cwd, dispatching by `buildEvent` returning `{ eventType: "flow:run", data: { flowName, task } }` (a malformed `flow` id emits nothing). The run finalizes on `agent_end`. Flows SHALL NOT contribute `flows.resume` or `flows.cancel`.

If flows is disabled or not loaded, it SHALL publish nothing and `flows.run` SHALL NOT appear.

#### Scenario: flows publishes its contribution

- **WHEN** the flows plugin loads
- **THEN** it SHALL call `provide("automation.action.flows", …)` with a `flows.run` contribution and SHALL consume no automation service.

#### Scenario: flows works without automation present

- **WHEN** the automation plugin is absent or loads after flows
- **THEN** flows SHALL load and publish its contribution without error, and automation (if present) SHALL collect it lazily.

#### Scenario: resume and cancel are not offered

- **WHEN** flows publishes its contribution
- **THEN** neither `flows.resume` nor `flows.cancel` SHALL be present.
