## MODIFIED Requirements

### Requirement: flow_write card renders a Mermaid snapshot parsed from tool args

On a successful `flow_write`, the card SHALL render a static flow-graph snapshot and the step/agent/code counts. Because the result carries no parsed steps, the renderer SHALL parse the YAML from the tool ARGS (the submitted `content`) client-side, generate a Mermaid graph string, and render it via the `ui:markdown-content` primitive (which renders ```mermaid fences through MermaidBlock with zoom/pan).

The generated Mermaid edge set SHALL be produced by the shared flow-edge derivation (see `flow-graph-edges`) and SHALL include, in addition to the existing `blockedBy` sequential edges and decision `branches` edges: implicit-segment edges (a step after a separator with no `blockedBy`) and `on_complete`/`on_error` routing edges. The snapshot SHALL therefore match the live FlowGraph's edge set for the same flow. Backward edges (branch/route targeting an earlier step, `max_iterations` loops) SHALL render dashed.

#### Scenario: Snapshot derived from args
- **WHEN** a `flow_write` call succeeds with YAML in its `content` arg containing 3 steps (2 agents, 1 code)
- **THEN** the card SHALL display "3 steps · 2 agents, 1 code"
- **AND** SHALL render a Mermaid graph of those steps via the markdown-content primitive

#### Scenario: Unparseable args degrade gracefully
- **WHEN** the YAML args cannot be parsed client-side
- **THEN** the card SHALL still show the success state and command
- **AND** SHALL omit the graph/counts without erroring

#### Scenario: Implicit-segment edges appear in the snapshot
- **WHEN** the YAML has a step following a separator (`fork` / `agent-decision` / `code-decision`) with no `blockedBy`
- **THEN** the Mermaid graph SHALL include an edge from the preceding separator to that step
- **AND** the snapshot SHALL NOT emit a `flow-ref` node shape

#### Scenario: on_complete / on_error edges appear in the snapshot
- **WHEN** a step in the YAML declares `on_complete` (or `on_error`) targeting another step
- **THEN** the Mermaid graph SHALL include that routing edge
