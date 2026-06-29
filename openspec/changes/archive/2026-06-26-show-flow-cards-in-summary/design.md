## Context

`FlowSummary` (`packages/flows-plugin/src/client/FlowSummary.tsx`) mounts when `flow_summary_ready` fires. The reducer keeps `flowState.agents` (the full `FlowAgentState` map) after completion, so the same data the live `FlowDashboard` grid renders via `FlowAgentCard` is still available. Today `FlowSummary` renders only a `FlowGraph` + a list of `FlowSummaryRow` (terse, per-agent, already individually expandable). The live `FlowDashboard` renders the cards with `<FlowAgentCard agent session sessionId flowId />` in a `repeat(auto-fill, minmax(200px,1fr))` grid.

The pi-flows analogue (`show-cards-in-flow-summary`) re-renders the snapshot frozen above the summary lines (Option A: re-render snapshot, don't keep the live widget mounted). The dashboard is already Option A — `FlowSummary` is a separate component from `FlowDashboard`; it just needs to render the cards from the persisted state.

## Goals / Non-Goals

**Goals:**
- Render frozen `FlowAgentCard` grid in `FlowSummary`, above the summary lines, from `flowState.agents`.
- Make the summary-lines section (graph + rows) a collapsible unit; default expanded.
- Keep card affordances (eye/detail popout, view-source) working → thread `session`/`sessionId`.
- Graceful fallback: an agent with no meaningful card still appears as a summary row.

**Non-Goals:**
- No reducer/protocol/event changes — `flowState.agents` already persists.
- No overflow cap on tall grids (deferred, matching pi-flows).
- No change to per-row expand/collapse, dismiss, or agent-detail navigation.
- No new "freeze" flag on `FlowAgentCard` — when the flow is terminal the card is already effectively static.

## Decisions

**Decision: Reuse `FlowAgentCard` as-is in a plain grid, not a new frozen variant.** `FlowAgentCard` already renders terminal agents read-only (no live-only mutation on mount). Re-rendering it from the persisted `flowState.agents` yields the frozen snapshot for free. *Alternative considered:* a `readOnly` prop / separate static card — rejected as redundant; the card is already inert post-completion.

**Decision: cards always visible; the summary section collapses.** Cards are the at-a-glance detail (the thing the user wanted back); the graph + summary rows are the scannable TL;DR and can be hidden. The existing top-level `collapsed` state is repurposed to toggle the summary section only; cards render outside that collapse. *Alternative considered:* collapse the cards too — rejected; the whole point is to keep cards visible.

**Decision: thread `session`/`sessionId` into `FlowSummary`.** `FlowAgentCard` needs them for the detail-popout and view-source popovers. `FlowSummaryClaim` already has `session`; pass `session` + `session.id` down. Without them the cards would render but lose drill-in (the deep history the pi-flows spec routes via `alt+o`).

## Risks / Trade-offs

- [Tall grids overflow on many-agent flows] → Accepted, no cap (matches pi-flows; revisit if it bites). The grid wraps via `auto-fill` so it grows vertically, not off-screen horizontally.
- [`FlowAgentCard` assumes live context (send fn / popout state)] → It already runs inside the same plugin providers in `FlowSummaryClaim`'s tree; verify the eye/detail popover opens from the summary. If a provider is missing, fall back to rendering cards without the popout (cards still show).
- [Duplicate info: cards + summary rows show overlapping summaries] → Mitigated by making the summary section collapsible (default expanded); users who only want cards collapse it.

## Open Questions

- Should the summary section default collapsed (cards-first) or expanded (show everything)? Default **expanded** for discoverability; revisit if the duplication feels noisy.
