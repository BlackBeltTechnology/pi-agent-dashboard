# oversized-event-liveness.spec.ts — index

Playwright E2E for the per-event size ceiling (change: bound-subagent-event-serialization). Automates the change's open MANUAL task 5.3. Drives `[[faux:oversized-turn]]` (bash emits ~90 KB output → oversized event through the real ingest→persist→broadcast `JSON.stringify` path that used to OOM-crash the server), waits for `oversized-turn complete`, asserts `/api/health` 200 (no crash), then `[[faux:plain-text]]` round-trips in the SAME session (server alive + responsive; a crash would drop the session) + health 200 again. `spawnFreshGitSession` + `sendPrompt`; 3-consecutive-OK health gate in beforeEach. Needs `PI_E2E_SEED=1`.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 per-event size ceiling (bound-subagent-event-serialization).
