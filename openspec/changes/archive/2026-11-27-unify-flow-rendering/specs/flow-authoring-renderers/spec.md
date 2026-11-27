# Spec Delta

## ADDED Requirements

### Requirement: flow_write card renders the shared flow graph built from tool args
On a successful `flow_write`, the card SHALL render the flow graph (with expand-to-full-size) and step/agent/code counts from the `content` arg. It SHALL use Open flow's not-started pipeline, parsing leniently, and the flow panel's graph component and edge-visibility rules, including the error-route toggle. For YAML the panel accepts, under the same error-route toggle state, nodes and edges SHALL equal the panel's. Only a successful write draws a graph.

#### Scenario: Graph derived from args
- **WHEN** a `flow_write` call succeeds with YAML in its `content` arg containing 3 steps (2 agents, 1 code)
- **THEN** the card SHALL display "3 steps · 2 agents, 1 code"
- **AND** SHALL render the flow graph of those 3 steps

#### Scenario: Card graph matches the flow panel
- **GIVEN** a flow YAML with a decision step, an `on_error` route, and a separator step
- **WHEN** it is written with `flow_write` and the same YAML is opened in the flow panel
- **THEN** the card graph and the panel graph SHALL contain the same nodes and the same edges

#### Scenario: Object-form branches draw their edges
- **GIVEN** a decision step whose branches use the object form (`{ to, means }` or `{ to, for_each }`)
- **WHEN** the YAML is shown on a `flow_write` card or opened in the flow panel
- **THEN** each branch SHALL draw an edge to its `to` target

#### Scenario: Card tolerates YAML the strict parser would reject
- **GIVEN** a persisted `flow_write` whose YAML has no top-level `description` and a step with no `type`
- **WHEN** the card renders on replay
- **THEN** it SHALL still render the flow graph and counts, treating the untyped step as an agent step

#### Scenario: Invalid steps are skipped
- **GIVEN** a `flow_write` YAML with three steps, one of which has no `id`
- **WHEN** the card renders
- **THEN** it SHALL draw the two valid steps and display "2 steps"

#### Scenario: Unbuildable args degrade gracefully
- **WHEN** the args are not YAML, or have no step object with an `id` (including `steps: []`)
- **THEN** the card SHALL still show the success state and command
- **AND** SHALL omit the graph and counts without erroring

#### Scenario: No Mermaid output
- **WHEN** a `flow_write` card renders a graph
- **THEN** it SHALL NOT render a Mermaid code block

## MODIFIED Requirements

### Requirement: Authoring cards reconstruct from persisted tool entries on replay
Authoring cards are main-session tool calls (not flow-run events); they persist and replay through pi's ordinary session-entry replay, not the `flow-event` stream. The renderer SHALL reconstruct the card — including the flow graph, step/agent counts, and the "view file" sub-row — from the persisted tool input (args) and tool result, so a reloaded session renders the same card without a live tool execution.

#### Scenario: flow_write card replays from persisted entry
- **WHEN** a session reloads and a persisted `flow_write` tool call + result is replayed
- **THEN** the tool renderer SHALL rebuild the success/error state from the persisted result and the flow graph + counts from the persisted args

## REMOVED Requirements

### Requirement: flow_write card renders a Mermaid snapshot parsed from tool args
**Reason**: A separate YAML parser and Mermaid renderer drew the same flow differently from the flow panel and kept missing graph fixes.
**Migration**: Replaced by "flow_write card renders the shared flow graph built from tool args". The card now applies the flow panel's error-route toggle instead of drawing every edge. The legacy `on_complete` key is no longer drawn on the card; pi-flows rejects it at validation per `flow-graph-edges`. Implicit-segment and `on_error` edge coverage moves to the render-parity test, whose fixture asserts at least one `implicit` and one `on_error` route edge.
