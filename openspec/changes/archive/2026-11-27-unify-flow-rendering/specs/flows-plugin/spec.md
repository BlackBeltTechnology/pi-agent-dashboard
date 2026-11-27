# Spec Delta

## MODIFIED Requirements

### Requirement: Static YAML preview keeps object-form branches
The not-started flow pipeline that builds a graph from flow YAML (used by Open flow, `flow_open` and the `flow_write` card) SHALL accept object-form branch targets (`{ to, means }`, `{ to, for_each }`) in addition to string targets, and SHALL produce an edge to each `to` target.

#### Scenario: Object-form branch kept
- **WHEN** a flow YAML declares a branch `{ to: "fix", means: "bug found" }`
- **THEN** the graph built from that YAML SHALL include an edge to `fix`
