# background-stream-selection.spec.ts — index

Browser E2E for test-plan #F11 (capability `chat-selection-preservation`, change: fix-long-session-ux-degradation §6, design D6/D7). Holds a text selection in the selected session's transcript, then drives a DIFFERENT unselected session to stream assistant output; asserts the selection stays anchored and non-collapsed. Only this layer exercises a real browser `Selection` against live background churn.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): #F11 — held selection survives a background session stream.
