# tool-burst.spec.ts — index

Playwright spec for temporal burst grouping. Sends `[[faux:burst-heterogeneous]]` (3 distinct bash calls, last a `sleep 2`). Asserts `tool-burst-group` forms, `data-running="true"` + `tool-burst-live-command` shows `sleep` while running, auto-collapses to `3 tool calls` on done (`tool-burst-body` count 0), header click re-expands scrollbox with member rows. See change: group-tool-call-bursts.
