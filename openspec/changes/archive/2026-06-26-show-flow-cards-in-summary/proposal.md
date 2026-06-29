## Why

When a flow completes, the dashboard's `FlowSummary` widget throws away the rich `FlowAgentCard` grid that was built up live during the run and replaces it with terse per-agent summary lines. The cards — outputs, loop pills, tool history affordances, soft/hard failure visuals — are already in `flowState.agents` (the reducer keeps them after `flow_summary_ready`), so hiding them wastes information the user already paid to compute. This mirrors the pi-flows TUI change `show-cards-in-flow-summary`, translated to the dashboard.

## What Changes

- The post-flow `FlowSummary` SHALL render the preserved agent cards (frozen `FlowAgentCard` grid, same layout as the live `FlowDashboard`) above the summary lines. The cards reflect the final captured state and do not update.
- The summary section (FlowGraph + per-agent `FlowSummaryRow` lines) SHALL move beneath the cards and be **collapsible** as a unit, defaulting to expanded. The existing per-row expand/collapse stays.
- `FlowSummary` SHALL receive `session` / `sessionId` so the frozen cards keep their detail-popout (eye) and view-source affordances — the deep drill-in a static line cannot show.
- If an agent has no card snapshot, the summary line for it still renders (graceful fallback); no overflow cap is introduced (deferred until it bites), matching the pi-flows change.

## Capabilities

### Modified Capabilities
- `flow-summary-view`: adds the frozen agent-card grid above the summary lines; makes the summary-lines section a collapsible unit; threads session context so cards keep their affordances. Existing per-agent row expand/collapse, dismiss, and agent-detail navigation are unchanged.

## Impact

- `packages/flows-plugin/src/client/FlowSummary.tsx` — render the frozen `FlowAgentCard` grid; wrap FlowGraph + summary rows in a collapsible section; accept `session`/`sessionId` props; `FlowSummaryClaim` passes them through.
- Reuses the existing `FlowAgentCard` (already read-only when the flow is terminal) and the live grid's CSS grid layout. No reducer, protocol, or event changes — `flowState.agents` already persists post-completion.
- Tests: `FlowSummary.test.tsx` — cards rendered above summary lines, summary section collapsible, graceful fallback when an agent lacks a card.
