## ADDED Requirements

### Requirement: Behaviour-model generation

The skill SHALL ship generator prompts for sequence records (deepening a `sequence-from-ui` draft past the data-layer boundary) and state-machine records (one entity field), run one subagent per record, and accept a record only when `rebuild-package-diagrams` `check-sequences` / `check-states` pass with `--app`.

#### Scenario: Gate failure routed back
- **WHEN** a generated state machine fails `check-states`
- **THEN** the record is regenerated with the gate lines as findings and is not rendered until it passes
