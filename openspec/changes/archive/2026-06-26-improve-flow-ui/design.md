## Context

Three scoped, low-risk flow-UI defects in `packages/flows-plugin` (plus shared types), grouped together. The third is a removal: pi-flows deleted the `flow-ref` (subflow) node kind — its `NodeKind` is now `agent | fork | agent-decision | code | code-decision` — so the dashboard's matching surface is dead and must go.

**Graph edges.** The flow graph is rendered by two code paths:
- **Live** (`FlowGraph.tsx`): `flowStateToGraphSteps(flowState)` builds `FlowGraphStep[]` from `flowState.dagSteps`, then `buildGraph` lays them out with dagre. Edges come only from `step.blockedBy`, plus `synthesizeImplicitEdges` (exit-target + implicit-segment). `FlowGraphStep` has no `branches` field, so decision routing is invisible while running.
- **Static** (`flow-yaml-parse.ts`): `parseFlowYaml(content)` → `ParsedFlow`, then `flowToMermaid(flow)` emits a `graph LR` string. Edges come from `blockedBy` and `branches`. The parser reads `on_complete`/`on_error` into `ParsedFlowStep` but `flowToMermaid` never emits them, and it never synthesizes implicit-segment edges.

The two inputs differ (running `dagSteps` vs parsed YAML) but the *edge classification rule* should not. Today it is duplicated and divergent.

**Tool-call icon.** `FlowAgentDetail` → `MinimalChatView` renders tool calls via the shell-registered `toolCallStep` primitive (`packages/client/src/components/ToolCallStep.tsx`), whose header shows a leading status glyph (`statusIcons[status]`, or the help-circle for ask_user). `ToolCallStep` is also the main chat renderer, so the icon cannot simply be deleted.

## Goals / Non-Goals

**Goals:**
- One edge-classification rule, consumed by both renderers, so live and static graphs show the same edges for the same flow.
- Live graph renders decision-branch + `on_complete`/`on_error` edges; static snapshot renders implicit-segment + `on_complete`/`on_error` edges; backward/loop styling preserved in both.
- Remove the leading status glyph from tool-call rows in the flow agent detail view only.

**Non-Goals:**
- No change to the dagre layout engine, node shapes, or running-step highlight.
- No change to how `dagSteps` or YAML are sourced.
- No change to the main chat `ToolCallStep` icon, nor to tool name / result body / error styling anywhere.

## Decisions

**Decision: Extract a pure `deriveFlowEdges(steps)` helper over a common minimal step shape.**
Both inputs reduce to `{ id, type, blockedBy, branches?, onComplete?, onError? }` plus array order. The helper returns a typed edge list `{ from, to, label?, kind: "sequential" | "branch" | "route" | "implicit", backward: boolean }`. Live `buildGraph` and `flowToMermaid` both call it; each maps the edge list onto its own renderer (dagre `setEdge` / loopEdges vs Mermaid arrow syntax).
- *Alternative considered:* patch each renderer independently. Rejected — that is how they drifted; the bug recurs.

**Decision: `backward` is computed from declared step order** (target index ≤ source index), matching the existing `flowToMermaid` heuristic, so loop edges from `max_iterations` decisions render dashed in both views.

**Decision: hand-route backward/loop edges as arcs BELOW the node band; only forward edges feed dagre.** Edge-overlap research (fast subagent; dagre LayoutOptions, mermaid back-edge handling, ELK) was first tried as "feed every edge to dagre + acyclicer". That REGRESSED real flows: feeding a backward loop (`gate --fix--> implement`) plus cross-segment `on_complete` jumps made dagre's acyclicer reverse an edge and re-rank, splitting `verify`/`gate` into a separate band with long crossing routes. Reverted. The kept solution: forward edges feed dagre (clean acyclic ranking + label clearance via `edgesep: 22`); backward edges are hand-drawn as cubic arcs at `arcY = maxBottom + gap*(idx+1)` — BELOW every node. Because the arc's horizontal run sits beneath `maxBottom`, it provably cannot cross a node (every node is above it); multiple loops stagger downward. This restores the clean single-row layout while eliminating the original above-arc overlap (which crossed `quick-check`).
- *Why below, not above:* the original arc routed above all nodes but its bezier dipped to node-top height near the endpoints, clipping top-row nodes (`quick-check`). Below the band is empty space in LR layouts, so a sub-band arc is overlap-proof.
- *Alternatives considered:* (a) feed all edges to dagre — TRIED, regressed (see above); (b) stagger per-loop arc heights above — still clips top-row nodes; (c) ELK (`elkjs`) orthogonal routing — best crossing minimization but +500 KB, overkill for small flows. Revisit ELK only at 50+ nodes.

**Decision: Implicit-segment edges stay derivation-side, not input-side.** Fold the existing `synthesizeImplicitEdges` logic into the shared helper so the static path gets it too, rather than mutating parsed YAML.

**Decision: De-duplicate edges.** A branch target that also appears in `blockedBy`, or an `on_complete` that equals a sequential edge, MUST collapse to one edge (prefer the labeled/branch classification). Prevents double arrows in Mermaid and redundant dagre edges.

**Decision: Remove `flow-ref` everywhere, not soft-deprecate.**
pi-flows no longer emits the kind, so persisted-run replay can never produce it again; keeping the branch is dead code. Delete the `flow-ref` case from `FlowStepType`, `mapStepType`, `SEPARATOR_STEP_TYPES`, `nodeShape`, and `flow-reducer`, and drop `flowRefSteps` from `FlowState` and both graph-builder paths. Fold this into the shared `deriveFlowEdges` work so the separator set (`fork`, `agent-decision`, `code-decision`) is defined once without `flow-ref`.
- *Alternative considered:* leave `flow-ref` as inert fallback for old runs. Rejected — old persisted runs predate the new model and are not replayed; the inert branch only invites drift.

**Decision: Remove the multi-flow subflow tab bar only after confirming it has no other producer.**
`FlowTabBar` + the `flowStates`-driven tab list in `FlowDashboard` exist for "main + subflows" navigation and already no-op at `flowStates.size <= 1`. Subflows were the mechanism that produced more than one flow state per run; with them gone the tab bar is dormant. Task 6 verifies no other code path grows `flowStates > 1`, then removes the tab bar. The single-flow `flowStates.get(flowId)` lookups in the popout pages stay.

**Decision: graph nodes carry mdi icons + kind accents mirroring the cards.** Each node renders an mdi icon (24-unit path scaled into the SVG) + a left accent stripe, keyed by kind to match `FlowAgentCard` badges: code/code-decision = cyan (`mdiCodeTags` / `mdiCallSplit`), fork/agent-decision = amber (`mdiSourceBranch`), agent = `mdiRobotOutline` tinted by status. Replaces the old `⌗`/`◈`/`◇` text glyphs (the "#"-looking `⌗`). Node border/fill stay STATUS-driven (running/done legibility) — kind is shown via stripe+icon, exactly as the cards use a colored badge over a status border. Card badges switched to the same mdi icons for consistency.

**Decision: Hide the tool icon via an opt-out prop, not a fork.** Add `hideToolStatusIcon?: boolean` to `MinimalChatView`, threaded into `ToolCallEntry` and onto the `toolCallStep` primitive call as `hideStatusIcon`. `ToolCallStep` reads it and skips the leading `<Icon>` when set (default `false` → main chat unchanged). `FlowAgentDetail` passes `hideToolStatusIcon`.
- *Alternative considered:* a separate flow-only tool renderer. Rejected — duplicates the renderer for a one-line visual difference.

## Risks / Trade-offs

- [Live `dagSteps` may not carry `branches`/`on_complete`] → If the running event payload lacks branch/routing data, the live graph can only render what it has; the helper degrades to the available fields. Verify `FlowState.dagSteps` + `FLOW_EVENT_MAP` passthrough before wiring; if absent, scope the live branch-edge fix to what the payload exposes and note the gap.
- [Mermaid label/id escaping] → Branch labels / step ids with quotes or special chars can break Mermaid. The helper MUST emit safe labels (existing `nodeShape` quoting) and the static path keeps its `return null`-on-failure graceful degrade.
- [`ToolCallStep` is shared] → The opt-out defaults to `false`, so the main chat icon is provably unchanged; only `FlowAgentDetail` opts in.
- [`flowStates` has non-subflow producers] → Removing the tab bar is gated on task 6's verification. If any path legitimately yields `flowStates > 1`, the tab bar stays and only the `flow-ref` node/`flowRefSteps` are removed.

## Open Questions

- ~~Does the live `dagSteps` payload already include `branches` and `on_complete`/`on_error`?~~ **RESOLVED (task 1.1):** pi-flows `flow:flow-started` (flow-tui.ts) serializes `{ id, stepType, agent, blockedBy, branches }`. `branches` IS emitted (so live branch edges are achievable once the reducer captures it); `on_complete`/`on_error` are NOT in the started payload (live graph cannot render them — static YAML path only); `loopTarget`/`exitTarget` are no longer emitted (loops derive from backward branch targets). Live graph renders branch edges (backward branch = loop edge); `on_complete`/`on_error` edges remain static-snapshot-only and degrade to absent live.
- ~~Is the subflow tab bar the only producer of `flowStates.size > 1`?~~ **RESOLVED (task 6.1):** No. `FlowsSessionStateContext` keys `flowStates` by `flowName` and accumulates an entry per distinct flow run in a session, so running multiple top-level flows in one session also yields `flowStates.size > 1`. The tab bar is therefore KEPT (task 6.3); only the `flow-ref` node + `flowRefSteps` are removed. Subflow-specific comment wording stripped from `FlowDashboard`.
