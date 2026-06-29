## MODIFIED Requirements

### Requirement: FlowGraph renders the new node set minimally

The live FlowGraph SHALL stay minimal (node names + running-step highlight; details live in the cards) and SHALL render the canonical node set `agent`, `agent-decision`, `code`, `code-decision`, `fork` with backward/loop edges driven by `max_iterations`. The removed `conditional`, `agent-loop-decision`, `loopTarget`, and `flow-ref` mappings SHALL NOT be referenced; the FlowGraph SHALL NOT read `flowRefSteps`.

The rendered edge set SHALL be produced by the shared flow-edge derivation (see `flow-graph-edges`) and SHALL include, in addition to the existing `blockedBy` sequential and implicit-segment edges: decision-branch edges (`fork` / `agent-decision` / `code-decision` `branches`, labeled with the branch name), with a branch whose target is declared earlier rendered as a backward/loop edge. Decision routing SHALL be visible while the flow is running, not only in the static snapshot. `on_complete`/`on_error` routing edges are NOT part of the `flow:flow-started` payload pi-flows emits, so the live graph SHALL NOT be required to render them; they remain exclusive to the static `flow_write` snapshot (parsed from YAML).

#### Scenario: Code-decision node shape
- **WHEN** the graph contains a `code-decision` step
- **THEN** it SHALL render with a decision shape distinct from the plain agent node

#### Scenario: Backward loop edge
- **WHEN** a decision step has a backward edge with `max_iterations`
- **THEN** the graph SHALL render that edge as a backward/loop edge

#### Scenario: No dead node-type references
- **WHEN** the FlowGraph maps step types
- **THEN** it SHALL NOT branch on `conditional`, `agent-loop-decision`, `loopTarget`, or `flow-ref`

#### Scenario: No subflow node rendered
- **WHEN** a flow run is rendered
- **THEN** the FlowGraph SHALL NOT render any `flow-ref` / subflow node
- **AND** SHALL NOT read `flowState.flowRefSteps`

#### Scenario: Decision branch edges render while running
- **WHEN** a running flow contains a `fork` (or `agent-decision` / `code-decision`) step with `branches` targeting other steps
- **THEN** the live FlowGraph SHALL render an edge from the decision step to each branch target
- **AND** the edge SHALL be labeled with the branch name

#### Scenario: Backward branch renders as loop edge while running
- **WHEN** a running decision step has a branch whose target is declared earlier in the flow
- **THEN** the live FlowGraph SHALL render that branch as a backward/loop edge
