# tool-burst.spec.ts — index

Playwright spec for temporal burst grouping. Sends `[[faux:burst-heterogeneous]]` (3 distinct bash calls, last a `sleep 2`). Asserts `tool-burst-group` forms, `data-running="true"` + `tool-burst-live-command` shows `sleep` while running, auto-collapses to `3 tool calls` on done (`tool-burst-body` count 0), header click re-expands scrollbox with member rows. See change: group-tool-call-bursts.

See change: fix-chat-transcript-layout (#1100) — rAF sampler over `tool-burst-group`: #F1 ≤ 8-member burst opens while running, never > 8 member rows; #P1 tool joining a 40-member collapsed burst: row height ≤ collapsed + 40 px, 0 member rows; #P2 DOM nodes ≤ header baseline + 20 (scenario `burst-large`).
