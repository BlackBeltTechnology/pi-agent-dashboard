# optimistic-prompt.spec.ts — index

Playwright E2E for optimistic-prompt-progress. Two faux round-trip tests. Test 1: idle send → `pending-prompt-card` appears then confirms; widens window by delaying server→client WS frames via `page.routeWebSocket`. Test 2: mid-turn send during `[[faux:slow-stream]]`, Alt+Enter = followUp → no optimistic card, `queue-chip-followup` renders. Needs `PI_E2E_SEED=1`. See change: optimistic-prompt-progress.

add-composer-dock: follow-up chip assertion opens the dock Queue lane first (`expandQueueLane`). See change: add-composer-dock.
