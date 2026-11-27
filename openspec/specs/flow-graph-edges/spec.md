# flow-graph-edges Specification

## Purpose

Shared, pure edge-derivation for flow graphs: one `deriveFlowEdges` function maps a flow's steps to a canonical typed edge set consumed by its single rendering consumer, `FlowGraph`, which draws every flow surface (idle, running and completed panels and the `flow_write` card), so all surfaces show matching edges from a single source of truth.

## Requirements

### Requirement: Shared flow-edge derivation

The flows plugin SHALL provide one pure edge-derivation function that maps a flow's steps to a canonical edge set, consumed by the single flow-graph renderer (`FlowGraph`), which every surface uses: the not-started, running and completed flow panel and the `flow_write` card. Given a minimal step shape (`id`, `type` — the raw engine step type, never a display mapping that merges kinds — `blockedBy`, optional `branches`, optional `onComplete`, optional `onError`) plus declared step order, it SHALL return a typed edge list where each edge carries `from`, `to`, optional `label`, a `kind` of `sequential` | `branch` | `route` | `implicit`, and a `backward` flag. No surface SHALL derive edges from independent rules or a second renderer.

The caller SHALL pass `onError` when present, so that `on_error` `route` edges appear on every surface. It obtains it from the `flow:flow-started` per-step payload, and from the not-started step list built from flow YAML (used by the flow panel and the `flow_write` card), for every step kind. `on_complete` is a legacy YAML key that pi-flows rejects at validation and never executes. After this change no surface supplies it: neither the not-started step list built from YAML nor the `flow:flow-started` payload carries it. The function still accepts it, and when a step carries it, it SHALL yield a `route` edge; the `on_complete` scenarios pin this function-level behaviour only. It SHALL NOT remove the fall-through from its source: when the `on_complete` target is the source's next-segment entry, the single edge for that pair represents both. When the target is elsewhere, an edge from the source to its next-segment entry SHALL still exist. The function derives only the edge classes its input carries — a step that declares no routing yields no `route` edge.

An `implicit` edge models the engine's **fall-through**: after a segment finishes without routing, the engine runs the next declared segment. The function SHALL split the declared step list into segments as the engine does. Each step of type `code`, `code-decision`, `fork` or `agent-decision` is its own **separator** segment. Consecutive steps of any other type (`agent`, absent, or unknown) form one DAG segment. For unknown types this deliberately diverges from the engine, which would make them separators but rejects them at parse time. The graph tolerates them instead of throwing. Inside a DAG segment, a step depends on every `blockedBy` entry in the same segment, and an `on_error` target in the same segment depends on that route's source. The engine runs every DAG step, so that target runs after its source on success as well. The function SHALL emit a `sequential` edge for that dependency, kept alongside the `on_error` route. For each pair of adjacent segments the function SHALL synthesize an `implicit` edge from every **exit** of the earlier segment to every **entry** of the later one, where:

- the exit of a separator segment is the separator step itself, when it can complete without routing: a step without `branches`, or an `agent-decision` / `code-decision` with at least one **backward** branch (target declared at or before it). A `fork` never falls through, because its loops are uncapped. pi-flows requires such a loop to declare `max_iterations`, and the engine falls through to the next segment once that cap is reached. The rule is derived from `branches` and declared order alone, because the live payload carries no `max_iterations`;
- the exits of a DAG segment are its sinks — steps that no other step in the same segment depends on;
- the entry of a separator segment is the separator step; the entries of a DAG segment are its roots — steps with no dependency inside that segment.

The `implicit` edge SHALL be added even when its target already has other incoming edges. It SHALL NOT duplicate an existing non-error edge for the same `{from, to}` pair. When an `on_error` route connects the same pair, both edges SHALL be kept, because the success fall-through and the error route are distinct transitions. When an `on_error` route shares its pair with a decision `branch`, the labeled branch edge alone is kept, as today. Steps of the same DAG segment with no dependency between them remain **parallel siblings**, and the function SHALL NOT synthesize an edge between them. The last segment has no successor and yields no `implicit` edge. Fork `multiSelect` and `multi` decision continuation (the engine jumps to the furthest chosen target's segment, or activates only the chosen targets of the next segment) are deliberately NOT modelled. Their declared `branch` edges are drawn and nothing more, because the live payload carries no `multi` flag.

#### Scenario: Route edges appear in both views
- **WHEN** the derivation runs over two step lists carrying identical `blockedBy` + `branches` + `onError` data (one from `flow:flow-started`, one built from flow YAML for a not-started flow)
- **THEN** it SHALL produce the same set of edges including the `on_error` `route` edges

#### Scenario: on_complete-routed step before any separator is connected
- **WHEN** a step declared before any separator carries the legacy `on_complete` key
- **THEN** the derivation SHALL emit a `route` edge from that step to its `on_complete` target
- **AND** an edge from that step to its next-segment entry SHALL still exist (merged with the `on_complete` route when both target the same step)

#### Scenario: Routing target suppresses a spurious implicit edge
- **WHEN** a step with no `blockedBy` is the `on_error` target of an earlier step, and the step declared immediately before it is a decision whose `branches` are all forward
- **THEN** it SHALL have an incoming `route` edge, and that decision SHALL produce no `implicit` edge (it has no backward branch, so it is not a segment exit)

#### Scenario: Four edge classes derived
- **WHEN** a flow has `blockedBy` deps, decision `branches`, an `on_error` route, and a `code` step followed by another declared step
- **THEN** the edge list SHALL include a `sequential`, a `branch`, a `route`, and an `implicit` edge respectively

#### Scenario: Consecutive code steps chain in declared order
- **WHEN** a decision branches to code step `worktree`, and code steps `init` and `spawn` follow it in declared order with no `blockedBy`
- **THEN** the edge list SHALL include `worktree → init` and `init → spawn` as `implicit` edges
- **AND** it SHALL NOT include an edge from the decision to `init` or to `spawn`

#### Scenario: DAG segment sinks fall through to the next separator
- **WHEN** an agent step `triage` (sole step of its DAG segment) is followed in declared order by code step `cleanup`
- **THEN** the edge list SHALL include `triage → cleanup` as an `implicit` edge

#### Scenario: Fall-through into a step that already has incoming edges
- **WHEN** code step `retire` is followed in declared order by code step `report`, and `report` is also the target of a decision branch
- **THEN** the edge list SHALL include both the branch edge into `report` and the `implicit` edge `retire → report`

#### Scenario: Fall-through coexists with an on_error route to the same step
- **WHEN** code step `launch` declares `on_error: report` and `report` is the next declared step
- **THEN** the edge list SHALL contain both the `implicit` edge `launch → report` and the `on_error` `route` edge `launch → report`

#### Scenario: Decisions without a loop cap never fall through
- **WHEN** a single-select `code-decision`, `agent-decision` or `fork` step declares `branches` that all target later-declared steps
- **THEN** the derivation SHALL NOT emit an `implicit` edge out of it
- **AND** multi-select forks and `multi` decisions are not modelled beyond their declared branch edges

#### Scenario: Fork loop never falls through
- **WHEN** a `fork` has a branch targeting an earlier-declared step
- **THEN** the derivation SHALL NOT emit an `implicit` edge out of the fork

#### Scenario: Loop-capped decision falls through
- **WHEN** an `agent-decision` or `code-decision` has a backward branch (a loop bounded by `max_iterations`) and is followed in declared order by step `launch`
- **THEN** the edge list SHALL include an `implicit` edge from the decision to `launch`

#### Scenario: In-segment on_error target is not a root
- **WHEN** agent steps `a` and `b` share one DAG segment, `a` declares `on_error: b`, and neither declares `blockedBy`
- **THEN** the preceding segment's fall-through SHALL target `a` only
- **AND** the edge list SHALL contain a `sequential` edge `a → b` besides the `on_error` route
- **AND** the next segment's fall-through SHALL come from `b` only
- **AND** `b` SHALL NOT be error-only

#### Scenario: Unknown step type joins the DAG segment
- **WHEN** a step has no type or a type outside the separator set (e.g. a stale `flow-ref`)
- **THEN** the derivation SHALL treat it as a DAG-segment member and SHALL NOT throw

#### Scenario: Agent siblings in one segment stay parallel
- **WHEN** two consecutive agent steps have no dependency on each other
- **THEN** the derivation SHALL NOT emit an edge between them
- **AND** both SHALL receive an `implicit` edge from the preceding separator when it falls through

#### Scenario: Backward edge flagged
- **WHEN** a decision branch (or routing) targets a step declared earlier than its source
- **THEN** that edge SHALL have `backward: true`

#### Scenario: Duplicate edges collapse
- **WHEN** a decision branch target also appears in the same step's `blockedBy` (or an `on_complete` equals an existing sequential edge)
- **THEN** the derivation SHALL emit a single edge, preferring the labeled branch/route classification over the plain sequential one

### Requirement: on_error routes classified and rendered by topology

Each `route` edge labeled `on_error` SHALL carry a derived `routeTopology` of `returning` or `terminal`, computed purely from the derived edge set (no engine call). A route is **returning** when, following forward edges (`sequential` / `branch` / `implicit` / `on_complete`) from its handler target, the forward closure reaches a step on the main path at or after the route's source — the handler rejoins the flow. A route is **terminal** otherwise — its handler's forward closure never rejoins the main path. The classification reflects the engine, which keeps executing every step reachable from an `on_error` target after routing to it.

A node is **error-only** when it has at least one incoming edge and every incoming edge is either an `on_error` route or leaves another error-only node. Such a node is reachable only through error routes. A node with no incoming edge (a root) is never error-only. Renderers SHALL draw the two flavors differently. The error-route layer SHALL be toggleable per graph; its default visibility and persistence follow the requirement "Error-route layer hidden by default and its visibility persists":

- Every edge (including backward/loop and on_error routes) SHALL be routed by the layout engine through node-avoiding channels, such that no edge's rendered path intersects a node's bounding box. Hand-routed paths that only clear nodes on their horizontal run are NOT permitted. Two edges on the same `{from, to}` pair (a fall-through and an `on_error` route) SHALL both be laid out and drawn.
- A **returning** route SHALL be styled as an error-tinted loop edge (visually distinct from a normal decision loop — e.g. red vs purple) carrying its `returning` topology, routed (not hand-arced) so it does not cross nodes.
- Terminal routes whose target is **error-only** SHALL collapse into a single tail sink node (e.g. `⚠ N exits`) rather than N inline handler nodes with N crossing edges; the node SHALL be expandable to reveal the individual handler ids. The sink SHALL also pool every error-only node reachable only through those handlers (the handler's error-only tail), listed after its handler in the expanded view, so that no error-only node is drawn as an orphan. A terminal route whose target is reached by any non-`on_error` edge SHALL instead be drawn as an error-tinted edge carrying the terminal marker, pointing at that target drawn as a normal node. Such a target SHALL NOT be pooled into the sink, and its non-error incoming edges SHALL be drawn regardless of the error-layer toggle.
- When the error-route layer is toggled off, ALL on_error edges AND every **error-only** node (returning and terminal handlers alike), together with the edges leaving those nodes, SHALL be removed from the dagre layout input entirely. Hiding SHALL NOT be implemented as opacity over reserved layout cells. A node that is not error-only SHALL remain in the layout. The previous invariant (hidden-layer graph height equals that of the same flow with no `on_error` declared) is withdrawn: removing `on_error` turns an error-only node into a root, which changes the layout.

#### Scenario: Returning handler classified and looped
- **WHEN** a step's `on_error` targets a handler whose forward edges rejoin the main path
- **THEN** the route edge SHALL have `routeTopology: "returning"`
- **AND** it SHALL render as an error-tinted loop-styled edge whose routed polyline does not intersect any node box

#### Scenario: No edge crosses a node
- **WHEN** a flow contains loops and/or on_error routes (backward branches, returning/terminal handlers)
- **THEN** every rendered edge polyline SHALL avoid all node bounding boxes (zero edge-point-in-node intersections)

#### Scenario: Terminal handlers collapse to one sink
- **WHEN** two or more steps route `on_error` to error-only handlers whose forward closures never rejoin the main path
- **THEN** each such route edge SHALL have `routeTopology: "terminal"`
- **AND** the renderer SHALL collapse them into a single expandable tail sink node rather than drawing each handler inline

#### Scenario: Terminal target on the success path stays visible
- **WHEN** step `report` is the terminal `on_error` target of several steps AND is also reached by a decision branch or an `implicit` fall-through edge
- **THEN** `report` SHALL be laid out as a normal node with the error-route layer hidden AND shown
- **AND** the branch / `implicit` edges into `report` SHALL be rendered
- **AND** `report` SHALL NOT appear among the sink's handler ids

#### Scenario: Terminal handler tail pools into the sink
- **WHEN** steps route `on_error` to terminal handler `cleanup`, `cleanup` falls through to `notify`, and `notify` has no other incoming edge
- **THEN** with the error-route layer shown, neither `cleanup` nor `notify` SHALL be laid out as a node
- **AND** the sink's expanded handler list SHALL contain `cleanup` followed by `notify`

#### Scenario: Root nodes are never error-only
- **WHEN** a step has no incoming edge at all
- **THEN** it SHALL NOT be error-only and SHALL remain in the layout with the error-route layer hidden

#### Scenario: Handler that is also a branch target stays visible
- **WHEN** decision `rebase` declares `on_error: resolve`, and agent step `resolve` is also a `rebase` branch target
- **THEN** the `rebase → resolve` branch edge SHALL be drawn (the labeled branch edge represents the pair)
- **AND** `resolve` SHALL NOT be pooled into the sink or hidden with the error-route layer

#### Scenario: Mid-flow handler reached by fall-through stays visible
- **WHEN** an `on_error` handler step is also the next declared step after a non-routing separator
- **THEN** it SHALL NOT be error-only and SHALL remain in the layout with the error-route layer hidden

#### Scenario: Hidden error layer costs no layout
- **WHEN** the error-route layer is toggled off
- **THEN** the dagre layout input SHALL contain no `on_error` edges, no error-only nodes, and no edges leaving error-only nodes
- **AND** no layout cell SHALL be reserved for them

### Requirement: on_complete route edges render without a label

When the flow graph receives a `route` edge whose label is `on_complete`, it SHALL render it as a plain forward edge with NO visible label. Edge labels SHALL be shown only for `branch` edges (the branch name) and `on_error` route edges (their topology marker). This keeps a fully `on_complete`-routed flow legible — its happy-path spine reads as plain arrows rather than a chain of repeated `on_complete` labels on every surface that shows it.

#### Scenario: on_complete edge is unlabeled
- **WHEN** a `route` edge carries the label `on_complete`
- **THEN** the rendered edge SHALL be a plain solid forward arrow with no text label

#### Scenario: branch and on_error labels retained
- **WHEN** an edge is a decision `branch` or an `on_error` route
- **THEN** its label (branch name, or the `on_error` topology marker ↺/⊗) SHALL still be rendered

### Requirement: Error-route layer hidden by default and its visibility persists

The live `FlowGraph` error-route layer SHALL default to **hidden**, so a graph first renders showing only the happy path; the `⚠` toggle reveals the on_error edges + error-only handler nodes. The toggle state SHALL persist on the frontend in `localStorage` as a single **global** viewing preference (key `dashboard:flow-show-error-routes`) — not per session — because `FlowGraph` is a shared low-level component (summary, live dashboard, expand dialog) without a reliable session id. Reads/writes SHALL degrade to in-memory on `localStorage` failure. A user who turns error routes on SHALL find them on across remounts and across other graphs until they turn them off.

#### Scenario: Hidden by default on first view
- **WHEN** a flow graph with on_error routes renders and no stored preference exists
- **THEN** the error-route layer SHALL be hidden (only the happy path shown), with the `⚠` toggle available to reveal it

#### Scenario: Toggle state persists globally
- **WHEN** the user toggles error routes on (or off) on any graph
- **THEN** the choice SHALL be written to `localStorage` and restored on remount and on other graphs, until changed
