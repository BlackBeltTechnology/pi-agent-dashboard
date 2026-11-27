# Proposal

## Why

The same flow is drawn by different React code depending on where the user sees it. The run panel, the idle panel (Open flow / `flow_open`), the finished panel, and the `flow_write` transcript card use three pipelines, and they have drifted apart:

- The **finished** panel (`FlowSummary`) is a separate shell. It renders a flat `FlowAgentCard` grid without fan-out groups, decision routes, skipped pills, or the graph-first **Agent cards** section. It never received the `update-flows-plugin` (D6/D7) redesign, so a flow looks different the moment it ends.
- The **`flow_write`** card parses YAML with its own shallow parser (`flow-yaml-parse.ts`) and draws Mermaid through `MarkdownContent`. The layout engine and node styling are not `FlowGraph`'s, so the same flow looks different from what Open flow and a run show.

Every graph or card fix has to land in two or three places, and fixes keep being missed (e.g. `fix-flow-graph-engine-order` reached only `FlowGraph`).

## What Changes

- The finished flow renders through `FlowDashboard` in a `summary` mode instead of a separate `FlowSummary` shell. It gets the same graph, the same **Agent cards** section (`FlowStepCards`: fan-out groups, decision routes, state pills), and the same node→card selection. Summary-only parts stay: the status header, Run again / Open flow / Edit actions, Dismiss, whole-panel collapse, the **Summaries** list, and the **Next:** suggestion.
- `FlowSummary.tsx` shrinks to the summary-only sections and the completion status map. The `FlowSummary` shell component, its duplicated selection / dialog code, and the unregistered `FlowSummaryClaim` are removed.
- The `flow_write` card builds its graph with the same pipeline as Open flow. `buildIdleFlowState(content)` replays the YAML through the real reducer, and `<FlowGraph>` renders the result (with expand-to-dialog). Step counts come from that state. The card parses leniently, so persisted cards with older or incomplete YAML keep their graph.
- The not-started pipeline learns object-form decision branches (`{ to, means }`, `{ to, for_each }`). Today it turns them into `"[object Object]"` and drops their edges, in the Open flow panel as well.
- **BREAKING (internal):** `flow-yaml-parse.ts` (`parseFlowYaml`, `flowToMermaid`) and the Mermaid snapshot are removed. The `flow_write` card now follows the panel's error-route toggle and no longer draws the legacy `on_complete` key.
- A render-parity test feeds one flow YAML through idle, running, finished and the `flow_write` card. It asserts the same graph node and edge set on all four, and the same Agent cards structure for running vs finished.

Out of scope: an "Open in flow panel" action on the `flow_write` card. That is a follow-up change. It needs catalog-refresh and running-flow semantics of its own.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `flow-summary-view`: the finished panel uses the live panel's layout and `FlowStepCards` (Agent cards section) instead of a flat frozen card grid. Selection follows the live panel's reset rules. Header, Summaries list, Dismiss and collapse requirements are kept.
- `flow-authoring-renderers`: the `flow_write` card renders the shared `FlowGraph` built from the not-started pipeline, not a Mermaid snapshot. Replay rebuilds the graph from persisted args.
- `flow-graph-edges`: the edge derivation has a single rendering consumer (`FlowGraph`). Requirements that name the static Mermaid snapshot as a second consumer are rewritten.
- `flow-card-status`: the live-graph requirement no longer refers to the static `flow_write` snapshot.
- `flow-card-grid`: the mobile collapsed bar applies to not-started and running flows only; a completed flow renders its full panel.
- `dashboard-shell-slots`: the flow slot list drops `FlowSummary` on `content-inline-footer` (never registered); `FlowDashboard` renders completed flows.
- `flow-panel-collapse-persistence`: the completed-panel collapse is named by mode (`summary` kind) instead of the `FlowSummary` component.
- `flows-plugin`: object-form branch support moves from the static YAML parser to the not-started pipeline.
- `flow-question-routing`: the full question transcript is scoped to running flows; idle and completed panels show pending prompts only (the completed panel keeps them visible while collapsed).

## Impact

- Code (`packages/flows-plugin/src/`): `client/FlowDashboard.tsx`, `client/FlowSummary.tsx`, `client/FlowWriteToolRenderer.tsx`, `client/flow-idle-state.ts` (`branchesOf`), `client/index.tsx` exports. `client/flow-yaml-parse.ts` is removed. `FlowGraph.tsx` and `FlowStepCards.tsx` are unchanged.
- Tests (`packages/flows-plugin/src/__tests__/`): `FlowSummary.test.tsx`, `flow-dashboard-header-actions.test.tsx` (uses `FlowSummaryClaim`), `flow-dashboard-claim-attach.test.tsx` (summary testids, `data-flow-mode`), `flow-card-grid.test.ts` (asserts the grid helper in `FlowSummary.tsx`), `authoring-renderers.test.tsx`, `flow-idle-state.test.ts`; `flow-yaml-parse.test.ts` is removed. Playwright (summary DOM, testids, collapse): `tests/e2e/flow-card-grid-geometry.spec.ts`, `flow-code-node-tools.spec.ts`, `flow-attach-before-run.spec.ts`, `flows-dock-chip.spec.ts`, `flow-fanout-decision.spec.ts`, `flow-abort-plugin-action.spec.ts`, `flows-plugin-toggle-hidden.spec.ts`, `helpers/flows-chip.ts`.
- No server, bridge, protocol, or persistence changes. Dismissal replay (`flow-run-close`) is untouched.
- Docs: `packages/flows-plugin/src/client/AGENTS.md` and `src/AGENTS.md` rows. `packages/flows-plugin/README.md` component list. `docs/qa/distilled-current-test-cases.md`, `packages/extension/.pi/skills/browser/references/web.md` and `web.agent.md` mentions of `FlowSummary.tsx`. Purpose blurbs of `flow-authoring-renderers`, `flow-graph-edges` and `flow-summary-view` at archive.

## Discipline Skills

- `code-simplification`: the change exists to remove duplicated render paths. Run it after the parity test is green.
