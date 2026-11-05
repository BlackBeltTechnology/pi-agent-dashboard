# Spec Delta

## MODIFIED Requirements

### Requirement: Contract-pinned bridge-forward + reducer coverage

The L2 test suite SHALL be hermetic (no browser, no network, no runtime
dependency on pi-flows). It SHALL derive the flow event types it drives from the
flows plugin bridge declaration constant exported from
`packages/flows-plugin/src/bridge` (the `as` values of its declared channels,
not hand-typed strings and not a core map), feed a representative lifecycle
sequence through the flows-plugin reducer, and assert the resulting
`FlowState`. Real-engine event fidelity is covered at L3, not L2.

#### Scenario: contract-pinned lifecycle reduces to complete
- **WHEN** a lifecycle sequence built from the flows plugin bridge declaration's event types (started → agent-started → agent-complete → complete) is reduced from a null start
- **THEN** the reducer yields a `FlowState` whose status reaches `complete` and whose agents reach a terminal status

#### Scenario: reducer tolerates every mapped event without throwing
- **WHEN** each `flow_*` event type in the flows plugin bridge declaration is reduced (against a seeded state)
- **THEN** the reducer never throws, and declared events without a dedicated case leave state unchanged (default passthrough)

#### Scenario: core lifecycle events are handled, not silently dropped
- **WHEN** the core lifecycle events (`flow_started`, `flow_agent_started`, `flow_agent_complete`, `flow_complete`) from the flows plugin bridge declaration are reduced
- **THEN** each produces an observable `FlowState` mutation (state seeded, agent status advanced, flow status terminal)

#### Scenario: test imports no core flow map
- **WHEN** the L2 test sources are inspected
- **THEN** they SHALL NOT import a flow event map from `packages/extension`
