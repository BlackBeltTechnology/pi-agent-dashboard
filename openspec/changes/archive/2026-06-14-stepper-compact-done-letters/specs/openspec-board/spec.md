## MODIFIED Requirements

### Requirement: Lifecycle stepper on cards
Each card SHALL render the OpenSpec lifecycle stepper (Explore→Proposal→Design→Specs→Tasks→Apply→Archive) in the `compact` variant with done/current/todo node states; the Tasks node SHALL show `completed/total`. The connecting line SHALL NOT bleed through node interiors.

Because the card stepper is `compact` (per-node labels hidden), done artifact nodes (`Proposal`, `Design`, `Specs`, `Tasks`) SHALL render their artifact letter (`P`/`D`/`S`/`T`) rather than the mdi-check, so each done node remains identifiable without a label. Done non-artifact nodes (`Explore`, `Apply`, `Archive`) SHALL render the mdi-check.

#### Scenario: Stepper reflects state
- **WHEN** a change has proposal/design/specs done and is implementing with `6/14` tasks
- **THEN** the `Explore` node SHALL render done with a check, `Proposal`/`Design`/`Specs` SHALL render done with letters `P`/`D`/`S`, `Tasks` SHALL render current with `6/14`, and `Apply`/`Archive` SHALL render todo
