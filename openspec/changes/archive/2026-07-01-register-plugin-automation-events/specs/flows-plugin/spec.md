## ADDED Requirements

### Requirement: Flows registers automation actions

The flows plugin SHALL declare `dependsOn: ["automation"]`, consume the automation action registry at startup, and register the actions `flows.run`, `flows.resume`, and `flows.cancel`. Each action's `available(cwd)` SHALL return true only when one or more flows exist in that cwd. Registration SHALL no-op gracefully (logged) when the action registry is absent.

`flows.run` SHALL declare a `payloadSchema` with a `flow` enum field whose options resolve to the flows discovered in the cwd (from the `flows_list` source) and a `task` multiline string field. Its `dispatch` SHALL run the selected flow with the given task via the flows plugin's existing flow-run path.

#### Scenario: Actions available only where flows exist

- **WHEN** the dialog requests actions in a cwd containing flows
- **THEN** the Flows group SHALL be enabled and `flows.run`/`flows.resume`/`flows.cancel` SHALL be selectable.

#### Scenario: Disabled where no flows exist

- **WHEN** the dialog requests actions in a cwd with no flows
- **THEN** the Flows group SHALL be present but disabled with a reason and its actions SHALL NOT be selectable.

#### Scenario: flows.run dispatches the selected flow

- **WHEN** an armed automation with `action.kind: flows.run`, `action.payload: { flow: "nightly-build-and-tag", task: "build and tag" }` fires
- **THEN** the flows plugin SHALL run the `nightly-build-and-tag` flow seeded with the given task.

#### Scenario: Registry absent degrades gracefully

- **WHEN** the flows plugin loads and `consume("automation.action-registry")` returns undefined
- **THEN** flows SHALL log and continue without registering actions, and SHALL NOT crash.
