# Design

## Context

See proposal.md (Why). This section records the engine facts the edge rule must mirror. Source: pi-flows 0.10.0, installed at `~/.pi/agent/npm/node_modules/@blackbelt-technology/pi-flows/extensions/flow-engine/`.

- **Segmentation.** `splitIntoSegments` (`flow-execution.ts:411-432`) walks steps in declared order. Consecutive `stepType === "agent"` steps form one `dag` segment, and every other step is its own `separator` segment. The node kinds form a closed set: `NodeKind`, `types.ts:205-210`. An unknown type such as `flow-ref` is rejected by the parser (`flow-parser-yaml.ts:127-135`).
- **Program counter.** The run loop (`flow-execution.ts:208-320`) executes `segments[segmentIndex]`. When the result carries `nextStepId` (a branch, or `on_error` on a soft failure), the loop jumps to that step's segment (`:305-315`). Otherwise it continues with `segmentIndex++` (`:241`, `:318`): the next declared segment runs.
- **Success never routes.** For agent and code steps, success falls through and only a soft failure routes to `on_error` (`:741-748`, `:751-767`). The code comment at `:755` reads "Code nodes run as separator steps".
- **Loop cap falls through.** A decision's backward branch is bounded by `max_iterations`. The validator requires that bound (`tools/flow-validate.ts:753-813`). At the cap, `routeDecisionBranch` returns no target (`flow-execution.ts:697-703`, `:723-726`), so the decision falls through to the next segment. An exhausted decider chain never falls through: it routes to `on_error` or halts (`routeExhaustedDecision`, `:1436-1447`).
- **In-segment on_error is a dependency.** Inside a DAG segment, an `on_error` target waits for its source (`:472-477`). Dependencies outside the segment count as satisfied (`:468-470`, `:500-505`).
- **No `on_complete`.** The validator rejects it as an error (`tools/flow-validate.ts:568-578`; pi-flows `CHANGELOG.md` marks the removal BREAKING).
- **Live payload.** `flow:flow-started` carries `{id, stepType, agent, blockedBy, branches, onError}` per step (`flow-tui.ts:613-627`). It carries no `max_iterations` and no `on_complete`.

Dashboard today:
- `deriveFlowEdges` (`packages/flows-plugin/src/client/flow-edges.ts:57-127`) treats only `fork`, `agent-decision` and `code-decision` as separators (`:55`).
- It draws an `implicit` edge only into a step that has no `blockedBy` and no incoming edge, and draws it from the *most recent separator* (`:109-118`).
- `add()` merges any edge with an existing pair (`:65-77`), so a fall-through would be swallowed by an `on_error` route on the same pair.
- `computeLayout` (`FlowGraph.tsx:265`) excludes every terminal `on_error` target from the graph, even when a non-error edge also reaches it. Branch edges into that target are dropped as a side effect (`:303`). Its dagre graph is not a multigraph (`g.setEdge(from, to, …)`, `:304`).
- The idle pre-run path (`flow-idle-state.ts:99-108`) passes `onError` only for `agent` and `code`, and drops it for `code-decision`, `fork` and `agent-decision`.
- The static Mermaid caller (`flow-yaml-parse.ts:114-143`) draws every derived edge, with no error toggle and no sink.

## Goals / Non-Goals

**Goals:**
- Every success transition the engine can take is drawn as an edge: fall-through, branch, and loop-cap exit. "What runs after X" is answerable from the graph.
- One rule is shared by both renderers.

**Non-Goals:**
- Layout direction, node shapes, start/end markers, loop-arc styling, edge labels for fall-through.
- Exact modelling of fork `multiSelect` and `multi` decisions. A multi-select fork jumps to the *furthest* selected target's segment (`flow-execution.ts:279-300`). A `multi` decision always continues in the next segment with only the chosen targets active (`:259-272`). Neither is computable from the live payload, which carries no `multi` flag (`flow-tui.ts:613-627`). The graph shows their declared branch edges only.
- Removing the legacy `on_complete` parsing from the static caller. It stays as a `route` edge source but no longer influences fall-through.
- Changing pi-flows or the `flow:flow-started` payload.

## Decisions

### D1. Fall-through edges from segment exit to next segment entry

The function splits steps into segments the way the engine does. The separator set is closed: `code`, `code-decision`, `fork`, `agent-decision`. Any other type (`agent`, absent, or unknown) is a DAG member. For unknown types this deliberately diverges from `splitIntoSegments`, which would treat them as separators; the parser rejects them first (`flow-parser-yaml.ts:127-135`), so the graph just tolerates them.

The rule needs the **raw** step type, because `fork` and `agent-decision` behave differently. The live caller today passes `mapStepType`'s display type, which merges `agent-decision` into `fork` (`FlowGraph.tsx:36-41`). `FlowGraphStep` therefore gains a raw `kind` field: `flowStateToGraphSteps` fills it from `dagSteps[].stepType`, and `computeLayout` feeds it to `deriveFlowEdges` instead of the display type.

Inside a DAG segment, a step depends on:
- its in-segment `blockedBy` entries;
- the source of any in-segment `on_error` route that targets it.

For each adjacent segment pair `(i, i+1)`:
- **exits(i)**:
  - A separator without `branches`.
  - An `agent-decision` or `code-decision` with at least one backward branch (it falls through at its loop cap via `routeDecisionBranch`). Backward is derived from declared order, so the rule needs no `max_iterations`. A `fork` is excluded: `executeForkStep` returns `branches[answer]` directly with no cap (`flow-execution.ts:1262-1269`), and the validator exempts forks from loop rules (`tools/flow-validate.ts:753-770`).
  - For a DAG segment: its sinks. A sink is a step nothing else in the segment depends on.
- **entries(i+1)**: the separator itself, or the DAG segment's roots (steps with no in-segment dependency).
- The rule adds an `implicit` edge for each exit × entry pair.

Two DAG segments are never adjacent, so the fan is one-sided: at most `max(|exits|, |entries|)` edges per boundary.

*Alternative considered:* add `code` to the old separator set. That would still miss `triage → cleanup`, `resolve → check` and `retire → report`, because those targets already have incoming edges or follow a DAG segment.

### D2. Keep the `implicit` kind; let it coexist with `on_error`

The edge kind set is unchanged. Two additions to `add()`. First, an in-segment `on_error` target gets a `sequential` edge from its source (the engine runs every DAG step, `flow-execution.ts:472-477`, `:496-507`), kept alongside the route. Second: an `implicit` edge is not merged into an existing `on_error` route on the same pair, and vice versa. Both stay in the list. `computeLayout` builds its dagre graph as a multigraph (`new graphlib.Graph({ multigraph: true })`, edges named by kind), so both parallel edges are routed; the render loop reads each edge back by name (`g.edge(from, to, name)`). A `branch` and an `on_error` route on the same pair still merge into the labeled branch edge, so the branch label is the only visible trace of that route. The static Mermaid caller emits two edges for that pair. *Alternative:* a new `fallthrough` kind. Rejected because it ripples into every `FlowEdgeKind` consumer for no visible gain.

### D3. Sink collapse and hiding only for error-only nodes

The terminal sink pools an `on_error` target only when the node is **error-only**: it has at least one incoming edge, and every incoming edge is `on_error` or leaves another error-only node (fixpoint). The existing `isErrorOnly` helper (`FlowGraph.tsx:257-260`) already rejects roots; it gains the transitive clause. The sink pools each terminal error-only handler together with its error-only tail (the nodes reachable only through it), in handler-then-tail order. No error-only node is ever drawn as an orphan root. (User decision during scenario-design.) A terminal route to any other target is drawn as an error edge to the real node. Hiding the layer removes the `on_error` edges, the error-only nodes, and the edges leaving those nodes.

The topology classification (`flow-edges.ts:133-173`) is unchanged, but it now traverses `implicit` edges. Some routes therefore become `returning`, which matches the engine. Separately, a handler that is also a branch target (`update-dashboard`'s `resolve`) is no longer pooled or hidden. Today `terminalHandlerIds` takes every terminal route target, even one that the branch edge represents, and hides it.

The old "graph height equals a flow with no `on_error`" invariant is dropped. Removing `on_error` from a flow turns an error-only node into a root, which does change the layout. The kept invariant is that the layout input contains no error edges or error-only nodes.

### D4. Idle path carries `onError` for every kind

`flow-idle-state.ts` adds `onError` to the `code-decision`, `fork` and `agent-decision` cases. The pre-run graph then matches the running graph and the `flow:flow-started` payload, which emits `onError` for every kind.

### D5. Tests pin engine-order shapes

Fixtures cover:
- the current repo flows `notes-to-issues` and `update-dashboard`, plus `ship-dispatch` as it stands now (`start, dispatch, retire, report`);
- the 10-step code-chain shape (`start, pick, worktree, init, spawn, record, fail, loop, retire, report`). It was ship-dispatch's earlier revision and is still the mock's frame 1.

The tests assert the engine-order edges and the absence of the old wrong edges (`pick → init`, `read → cleanup`, `rebase → check`). The mock carries the same data.

## Risks / Trade-offs

- [Engine semantics drift: a future pi-flows changes segmentation] → The design cites engine lines. A follow-up could have pi-flows emit successor lists on `flow:flow-started` (out of scope).
- [Busier graphs: fall-through edges plus a parallel error edge on the same pair] → The fan is one-sided per D1. Error edges are hidden by default.
- [Loop-cap fall-through edges are unlabeled and can read like an unconditional successor] → Accepted for now. Labelling is a layout follow-up.
- [Existing tests encode the old rule] → They are updated with the delta. Agent-only siblings inside one DAG segment keep their parallel assertions.

## Migration Plan

Client-only. Ships in the flows-plugin bundle. Rollback is reverting the commit. There is no persisted state or protocol to migrate.
