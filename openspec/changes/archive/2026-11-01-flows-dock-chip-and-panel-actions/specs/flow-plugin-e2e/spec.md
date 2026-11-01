## MODIFIED Requirements

### Requirement: Full-stack flow render e2e with faux model and real engine

The test suite SHALL run the real pi-flows engine in the Docker harness with
flow agents resolving to `faux/faux-1`, trigger a flow through the dashboard
run-flow surface, and assert the flow renders end-to-end.

#### Scenario: faux-modeled flow renders and completes
- **WHEN** a flow is launched from the FLOWS dock chip's Run flow… action in the Docker harness with agents wired to `faux/faux-1`
- **THEN** the FLOWS dock chip is present, a `FlowAgentCard` becomes visible, and the flow reaches a completed state in the UI
