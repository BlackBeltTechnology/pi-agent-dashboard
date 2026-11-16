# Proposal

## Why

The flows-plugin graph draws a different execution order from the one the pi-flows engine runs. A user looking at a run cannot tell which node comes after another.

On the repo's flows the graph:
- leaves running steps with no success edge out (`triage`);
- hides `on_error` handlers that rejoin the flow (`resolve`);
- hangs steps off the wrong parent (`read → cleanup`, `rebase → check`, and on a code chain `pick → init` / `pick → spawn` instead of `worktree → init → spawn`);
- hides the final `report` step together with every success branch into it.

The current `flow-graph-edges` spec codifies the wrong rule ("separator = fork / agent-decision / code-decision; ordinary steps are parallel siblings"), so this is a spec-level defect, not a styling one.

## What Changes

- Edge derivation (`deriveFlowEdges`) models the engine's segment program. Agent steps form parallel DAG segments, and every `code`, `code-decision`, `fork` and `agent-decision` step is its own segment. A finished step that does not jump falls through to the next declared segment.
- New **fall-through** (`implicit`) edges run from each segment exit to the next segment's entries:
  - Exits are a separator without branches, a loop decision (it falls through at its `max_iterations` cap), or a DAG segment's sinks.
  - Entries are a separator, or a DAG segment's roots.
  - Roots and sinks honour the engine's in-segment `on_error` dependency.
  - These edges replace today's "implicit edge from the last decision" rule.
- A fall-through edge and an `on_error` route on the same step pair are both kept. Today the error route swallows the success edge (e.g. `launch → report`).
- A step reached by any non-error edge is never collapsed into the terminal-error sink and is never hidden with the error layer. This restores `report` and the branches into it.
- The legacy `on_complete` key (rejected by pi-flows' validator) no longer influences fall-through.
- The idle pre-run graph passes `onError` for decision steps too, so the idle graph and the running graph agree.
- The live graph feeds the derivation the raw step type, so a `fork` is no longer merged with an `agent-decision`. Only decisions fall through at a loop cap; forks never do.
- The live `FlowGraph` and the static `flow_write` Mermaid snapshot both consume the shared derivation.
- **Visualization only.** The change touches only flows-plugin client rendering code. No flow YAML, fixture flow, pi-flows engine or protocol changes. Flows behave exactly as before; only what the graph draws changes.
- **Error routes stay first-class.** Every `on_error` route is still derived and drawn under the existing `⚠ error routes` toggle, with returning loops and the terminal sink. The change only stops error routes from erasing success edges or hiding success-path nodes.
- Out of scope: layout rework (direction, start/end markers, decision shapes, loop arcs, edge labels) and pi-flows emitting its order on `flow:flow-started`.
- Mockup: mockups/2026-11-16-flow-graph-fallthrough (in this change)

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `flow-graph-edges`:
  - "Shared flow-edge derivation" replaces the `implicit` segment-boundary rule with engine fall-through semantics, covering separators, loop-cap exits, in-segment `on_error` dependencies and coexistence with `on_error` routes.
  - "on_error routes classified and rendered by topology" narrows sink collapse and error-layer hiding to error-only nodes, defers default visibility to the hidden-by-default requirement, and withdraws the "hidden-layer height equals a flow with no `on_error`" invariant.
- `flow-authoring-renderers`: the Mermaid snapshot requirement redefines its implicit edges as fall-through edges and scopes the "matches the live graph" claim.
- `flow-card-status`: "FlowGraph renders the new node set minimally" drops the stale claim that `on_error` is absent from `flow:flow-started`, and names fall-through edges.

## Impact

- Code:
  - `packages/flows-plugin/src/client/flow-edges.ts` (derivation)
  - `packages/flows-plugin/src/client/FlowGraph.tsx` (`computeLayout`: multigraph, sink and exclusion rule)
  - `packages/flows-plugin/src/client/flow-idle-state.ts` (`onError` for decisions)
  - `packages/flows-plugin/src/client/flow-yaml-parse.ts` (parallel edges in Mermaid)
- Tests: `flow-edges.test.ts`, `FlowGraph.test.ts`, `flow-idle-state.test.ts`, `flow-yaml-parse.test.ts`, `FlowYamlPreview.test.tsx` under `packages/flows-plugin/src/__tests__/`.
- No protocol, server, or bridge change. pi-flows is unchanged.
- Visual change on every flow graph: more edges appear, some nodes change rank, and previously hidden handler nodes that rejoin the flow become visible.

## Discipline Skills

- **`doubt-driven-review`**: the edge rule mirrors an external engine (pi-flows `flow-execution.ts`). A misread of segmentation or routing would ship a second wrong graph. Applied during planning (2 reviewers, cross-model).
- None of `security-hardening`, `performance-optimization` or `observability-instrumentation` applies: the change is a pure client-side derivation with no untrusted input, no latency budget and no new endpoint.
