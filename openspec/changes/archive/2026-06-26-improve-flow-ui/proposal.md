## Why

Three flow-dashboard-UI defects: (1) the flow graph is drawn twice by two divergent edge-derivation rules, so the live graph drops decision-branch edges while running and the static `flow_write` Mermaid snapshot drops implicit-sequential and `on_complete`/`on_error` routing edges (renders "completely wrong"); (2) the per-tool-call status glyph in the flow agent detail view is visual noise the user wants gone; and (3) pi-flows removed the `flow-ref` (subflow) node kind entirely — its `NodeKind` is now `agent | fork | agent-decision | code | code-decision` — so the dashboard's `flow-ref` node, `flowRefSteps` data, and multi-flow subflow tab navigation are dead surface that must be removed.

## What Changes

### Flow graph edges (live + static parity)

- Introduce a single shared edge-derivation that both renderers consume, so the live `FlowGraph` and the static Mermaid snapshot always agree on the edge set for a given flow.
- **Live `FlowGraph` (`flowStateToGraphSteps` / `buildGraph`):** render decision-branch edges (`fork` / `agent-decision` / `code-decision` `branches`) and `on_complete`/`on_error` routing edges, in addition to the existing `blockedBy`, `exitTarget`, and implicit-segment edges. Branch edges currently are not modeled at all (the `FlowGraphStep` type carries no `branches`).
- **Static Mermaid (`flow-yaml-parse.ts` / `flowToMermaid`):** render implicit-sequential edges (step after a separator with no `blockedBy`) and the parsed-but-unused `on_complete`/`on_error` edges, in addition to the existing `blockedBy` and `branches` edges.
- Backward/loop edges (decision branch targeting an earlier step, `max_iterations`) keep their distinct dashed/loop rendering in both views.

### Flow agent tool-call icon

- Hide the per-entry status glyph on tool-call rows inside the flow agent detail view (`FlowAgentDetail` → `MinimalChatView`). The tool name, result body, and error styling stay; only the leading status icon is removed.
- Scope the removal to the flow agent views via a `MinimalChatView` opt-out; the main chat `ToolCallStep` icon is unchanged.

### Remove subflow (`flow-ref`) surface

- **BREAKING (removal):** delete the `flow-ref` node kind from every dashboard type and renderer (`FlowStepType`, `mapStepType`, `SEPARATOR_STEP_TYPES`, the `nodeShape`/`flowToMermaid` case, the `flow-reducer` case), matching pi-flows' new `NodeKind`.
- Remove the `flowRefSteps` field from `FlowState` and the graph builders that read it (both the `dagSteps` and the fallback `agents`-map paths in `flowStateToGraphSteps`).
- Remove the dead `conditional` / `agent-loop-decision` / `flow-ref` entries from the legacy `stepType` union in `packages/shared/src/types.ts`.
- Remove the multi-flow subflow tab navigation (`FlowTabBar`, the `flowStates`-driven tab list in `FlowDashboard`) once verified that subflows were its only producer; popout-page `flowStates` lookups stay (single-flow keyed access).

## Capabilities

### New Capabilities
- `flow-graph-edges`: The canonical flow-edge-set derivation shared by the live FlowGraph and the static Mermaid snapshot. Defines the four edge classes (sequential `blockedBy`, decision `branches`, `on_complete`/`on_error` routing, implicit-segment) and backward/loop classification, so both renderers produce the same edges for the same flow.

### Modified Capabilities
- `flow-card-status`: The live FlowGraph requirement adds decision-branch edges and `on_complete`/`on_error` routing edges to the rendered edge set.
- `flow-authoring-renderers`: The `flow_write` Mermaid-snapshot requirement adds implicit-sequential and `on_complete`/`on_error` edges to the generated Mermaid graph.
- `flow-agent-detail`: The tool-call-history requirement drops the leading per-entry status glyph; rows keep tool name, collapsible output, and error accent.
- `flow-card-status`: The canonical node set drops `flow-ref`; the live FlowGraph no longer renders subflow nodes or `flowRefSteps`.
- `flow-event-bridge`: The `FLOW_EVENT_MAP` `nodeKind` union drops `flow-ref`, matching pi-flows' `NodeKind`.

## Impact

- `packages/flows-plugin/src/client/FlowGraph.tsx` — `FlowGraphStep` gains branch/routing edge data; `buildGraph` emits the new edges.
- `packages/flows-plugin/src/client/flow-yaml-parse.ts` — `flowToMermaid` emits implicit + `on_complete`/`on_error` edges; a shared edge-derivation helper.
- `packages/flows-plugin/src/client/FlowAgentDetail.tsx` — passes the icon opt-out to `MinimalChatView`.
- `packages/client-utils/src/minimal-chat/MinimalChatView.tsx` — threads a `hideToolStatusIcon` prop to the tool-call entry; `packages/client/src/components/ToolCallStep.tsx` honours it (default unchanged).
- `packages/shared/src/types.ts` — drop `flow-ref` from `FlowStepType`, the `flowRefSteps` field, and dead entries from the legacy `stepType` union.
- `packages/flows-plugin/src/flow-reducer.ts`, `FlowGraph.tsx`, `flow-yaml-parse.ts` — drop the `flow-ref` cases and `flowRefSteps` handling.
- `packages/flows-plugin/src/client/FlowDashboard.tsx` + `FlowTabBar.tsx` — remove the subflow tab navigation if subflows were its sole producer.
- Tests: `packages/flows-plugin/src/__tests__/FlowGraph.test.ts` (edge parity + no `flow-ref`), MinimalChatView/FlowAgentDetail icon coverage.
- No protocol or server changes beyond the shared-type removals; no external dependency changes.
