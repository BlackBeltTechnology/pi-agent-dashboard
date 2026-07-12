# flow-plugin-e2e Specification

## Purpose
TBD - created by archiving change add-flow-plugin-e2e-tests. Update Purpose after archive.
## Requirements
### Requirement: Anthropic bridge peer-probe name-skew regression coverage

The test suite SHALL prove the anthropic bridge probes the scoped peer name
`@blackbelt-technology/pi-anthropic-messages` before the legacy
`@pi/anthropic-messages`, so a peer published only under the scoped name
resolves.

#### Scenario: scoped name resolves, legacy absent
- **WHEN** `probeAll` runs with a resolver that resolves only the scoped name and throws for the legacy name
- **THEN** `am.ok` is true, `am.via` is `"node"`, and `bothPresent` reflects the scoped hit

#### Scenario: legacy-only peer still resolves via fallback
- **WHEN** the resolver resolves only `@pi/anthropic-messages`
- **THEN** `am.ok` is true (legacy fallback), proving both names are probed

#### Scenario: neither name resolvable surfaces the failure reason
- **WHEN** the resolver throws for both names and no pi-packages tier-2 hit exists
- **THEN** `am.ok` is false and `am.reason` carries the last probe's error string

### Requirement: Anthropic bridge two-tier + listener resolution coverage

The test suite SHALL cover tier-1 (`createRequire(cwd).resolve`) miss with
tier-2 (`resolvePiPackage`) hit, and the pi-flows `flow:register-agent-extension`
listener fallback.

#### Scenario: tier-1 miss, tier-2 hit
- **WHEN** tier-1 `resolve` throws `MODULE_NOT_FOUND` but `resolvePiPackage` returns an entry path
- **THEN** the peer probe reports `ok: true`, `via: "pi-packages"`, and the returned `entryPath`

#### Scenario: pi-flows present only via listener
- **WHEN** the pi-flows module spec does not resolve but `flowsListenerCount()` returns a positive value
- **THEN** the flows peer is reported present with a reason naming the `flow:register-agent-extension` listener

### Requirement: Flow reducer seed-on-start coverage

The test suite SHALL prove the flows-plugin `flow-reducer` seeds `FlowState`
only from the initial flow-start event and drops later events when no start was
observed.

#### Scenario: missing start event yields null state
- **WHEN** a `flow_agent_complete` event is reduced against a null `FlowState`
- **THEN** the reducer returns null (no state fabricated from a non-start event)

#### Scenario: start then progression builds state
- **WHEN** a flow-start event is reduced, then agent-started and agent-complete events
- **THEN** `FlowState.status` progresses and agent entries reach a terminal status

### Requirement: Contract-pinned bridge-forward + reducer coverage

The L2 test suite SHALL be hermetic (no browser, no network, no runtime
dependency on pi-flows). It SHALL derive the flow event types it drives from the
bridge `FLOW_EVENT_MAP` values (not hand-typed strings), feed a representative
lifecycle sequence through the flows-plugin reducer, and assert the resulting
`FlowState`. Real-engine event fidelity is covered at L3, not L2.

#### Scenario: contract-pinned lifecycle reduces to complete
- **WHEN** a lifecycle sequence built from `FLOW_EVENT_MAP` values (started → agent-started → agent-complete → complete) is reduced from a null start
- **THEN** the reducer yields a `FlowState` whose status reaches `complete` and whose agents reach a terminal status

#### Scenario: reducer tolerates every mapped event without throwing
- **WHEN** each `flow_*` value in `FLOW_EVENT_MAP` is reduced (against a seeded state)
- **THEN** the reducer never throws, and mapped events without a dedicated case leave state unchanged (default passthrough)

#### Scenario: core lifecycle events are handled, not silently dropped
- **WHEN** the core lifecycle events (`flow_started`, `flow_agent_started`, `flow_agent_complete`, `flow_complete`) from `FLOW_EVENT_MAP` are reduced
- **THEN** each produces an observable `FlowState` mutation (state seeded, agent status advanced, flow status terminal)

### Requirement: Full-stack activation + render e2e with faux model and real engine

The test suite SHALL run the real pi-flows engine in the Docker harness with
flow agents resolving to `faux/faux-1`, trigger a flow through the dashboard
run-flow surface, and assert the flow renders end-to-end.

#### Scenario: faux-modeled flow renders and completes
- **WHEN** a flow is launched from the dashboard run-flow launcher in the Docker harness with agents wired to `faux/faux-1`
- **THEN** the availability gate opens (run-flow launcher present), a `FlowAgentCard` becomes visible, and the flow reaches a completed state in the UI

#### Scenario: anthropic bridge reports active when both peers present
- **WHEN** the harness has both `@blackbelt-technology/pi-anthropic-messages` and `pi-flows` installed
- **THEN** `/api/health` reports the `flows-anthropic-bridge` plugin with `bridgeLoadedFrom: "packages[]"` and status `active`

### Requirement: Docker harness peer-presence variants

The harness SHALL support selecting which peers are installed so activation
failures can be asserted, covering at least: both peers, missing anthropic
peer, legacy-name-only, and bridge-registered-only-in-dashboardPluginBridges.

#### Scenario: missing anthropic peer parks the bridge
- **WHEN** the harness starts without the anthropic-messages peer
- **THEN** the `flows-anthropic-bridge` status is `waiting_peers` and the peers report names the missing `@blackbelt-technology/pi-anthropic-messages`

#### Scenario: legacy-name-only variant reproduces the rename skew
- **WHEN** the harness provides the peer only under the legacy `@pi/anthropic-messages` name against a bridge that probes scoped-first
- **THEN** the bridge still resolves the peer (legacy fallback) and reaches `active`, proving the shipped probe tolerates both names

#### Scenario: registration-only-in-dashboardPluginBridges is invisible to pi
- **WHEN** the bridge is registered only under `dashboardPluginBridges` and not `packages[]`
- **THEN** the health surface reports the bridge as not loaded from `packages[]` (the "no sessions reporting" condition is detectable)

### Requirement: Subagents plugin render coverage

The test suite SHALL prove the subagents plugin renders its inspector/popout
surface when subagent events arrive.

#### Scenario: subagent inspector mounts on subagent activity
- **WHEN** a session produces subagent lifecycle events (via the faux scenario family or a real spawned subagent in the harness)
- **THEN** the subagents plugin renders its inspector surface reflecting the subagent activity

