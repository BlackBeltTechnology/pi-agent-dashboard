# Spec Delta

## ADDED Requirements

### Requirement: Full-stack flow render e2e with faux model and real engine

The test suite SHALL run the real pi-flows engine in the Docker harness with
flow agents resolving to `faux/faux-1`, trigger a flow through the dashboard
run-flow surface, and assert the flow renders end-to-end.

#### Scenario: faux-modeled flow renders and completes
- **WHEN** a flow is launched from the dashboard run-flow launcher in the Docker harness with agents wired to `faux/faux-1`
- **THEN** the availability gate opens (run-flow launcher present), a `FlowAgentCard` becomes visible, and the flow reaches a completed state in the UI

## REMOVED Requirements

### Requirement: Full-stack activation + render e2e with faux model and real engine
**Reason**: Its anthropic-bridge activation scenario covers the deleted `flows-anthropic-bridge` plugin.
**Migration**: Replaced by "Full-stack flow render e2e with faux model and real engine" (same render scenario, no bridge check).

### Requirement: Anthropic bridge peer-probe name-skew regression coverage
**Reason**: The `flows-anthropic-bridge` plugin and its peer probe are deleted.
**Migration**: None; no peer is probed. Flow-agent compat coverage lives under `claude-subscription-compat`.

### Requirement: Docker harness peer-presence variants
**Reason**: The variants only exercised the deleted `flows-anthropic-bridge` peer activation.
**Migration**: None; the harness no longer installs or omits `pi-anthropic-messages`.
