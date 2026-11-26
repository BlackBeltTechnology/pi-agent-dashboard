# Spec Delta

## MODIFIED Requirements

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

### Requirement: on_complete route edges render without a label

When the flow graph receives a `route` edge whose label is `on_complete`, it SHALL render it as a plain forward edge with NO visible label. Edge labels SHALL be shown only for `branch` edges (the branch name) and `on_error` route edges (their topology marker). This keeps a fully `on_complete`-routed flow legible — its happy-path spine reads as plain arrows rather than a chain of repeated `on_complete` labels on every surface that shows it.

#### Scenario: on_complete edge is unlabeled
- **WHEN** a `route` edge carries the label `on_complete`
- **THEN** the rendered edge SHALL be a plain solid forward arrow with no text label

#### Scenario: branch and on_error labels retained
- **WHEN** an edge is a decision `branch` or an `on_error` route
- **THEN** its label (branch name, or the `on_error` topology marker ↺/⊗) SHALL still be rendered
