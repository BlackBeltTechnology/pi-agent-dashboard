## MODIFIED Requirements

### Requirement: Lifecycle events carry nodeKind and failure outcome

The bridge's `FLOW_EVENT_MAP` passthrough SHALL preserve the `nodeKind` discriminator (`"agent" | "agent-decision" | "code" | "code-decision" | "fork"`) and the node failure outcome (`"success" | "soft" | "hard"`) on forwarded lifecycle events, so the dashboard can render distinct node cards and soft-vs-hard failure states without re-deriving them. The `flow-ref` kind is removed from the union, matching pi-flows' current `NodeKind`. Per the pi-flows `surface-node-kind` change, `nodeKind` is emitted by every executor, forwarded through the FlowManager seam, and carried inside the event `data` (the dashboard only preserves it; it does not synthesize it).

#### Scenario: nodeKind forwarded
- **WHEN** pi-flows emits `flow:agent-started` / `flow:agent-complete` for a step carrying `nodeKind: "code-decision"` in its `data`
- **THEN** the forwarded `flow_agent_started` / `flow_agent_complete` events SHALL retain `nodeKind: "code-decision"`

#### Scenario: Pre-contract runs lack nodeKind
- **WHEN** a forwarded lifecycle event has no `nodeKind` (a run persisted before `surface-node-kind`)
- **THEN** the passthrough SHALL forward the event unchanged and the dashboard SHALL treat the step as an agent card

#### Scenario: Failure outcome forwarded
- **WHEN** a step completes with a soft failure (routed to `on_error`) or a hard failure (flow halted)
- **THEN** the forwarded completion event SHALL carry the outcome so the card can distinguish soft from hard

#### Scenario: flow-ref kind not part of the contract
- **WHEN** the `nodeKind` discriminator is consumed by the dashboard
- **THEN** `flow-ref` SHALL NOT be a recognized `nodeKind` value
