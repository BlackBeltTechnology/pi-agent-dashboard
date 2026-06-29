## 1. Thread session context into FlowSummary

- [x] 1.1 Add `session: DashboardSession` + `sessionId: string` props to `FlowSummary`; `FlowSummaryClaim` passes `session` + `session.id`
- [x] 1.2 Verify `FlowAgentCard` renders inside `FlowSummary`'s provider tree (same plugin providers as FlowSummaryClaim — eye/detail popover + view-source work)

## 2. Render the frozen card grid

- [x] 2.1 In `FlowSummary`, render a `FlowAgentCard` grid from `flowState.agents` (reused `repeat(auto-fill, minmax(200px,1fr))` layout), ABOVE the summary section
- [x] 2.2 Cards are read-only (terminal agents are already inert); no new freeze flag
- [x] 2.3 Graceful fallback: agents with no card content still appear as a summary row; no throw, no empty frame

## 3. Collapsible summary section

- [x] 3.1 FlowGraph + per-agent `FlowSummaryRow` list wrapped in a single collapsible section beneath the cards (reused `collapsed` state), default expanded; added `data-testid="flow-summary-toggle"`
- [x] 3.2 Collapsing hides graph + summary lines (CSS `group-collapse`); cards stay visible; per-row expand/collapse unaffected

## 4. Tests + verify

- [x] 4.1 `FlowSummary.test.tsx`: cards render above summary section; collapse keeps cards visible; existing row tests scoped to the summary section (cards now also surface outputs)
- [x] 4.2 `tsc --noEmit` clean on touched files; flows-plugin suite green (96 tests)
- [x] 4.3 Build + restart done; manual visual check of the live test-flow summary deferred to user
