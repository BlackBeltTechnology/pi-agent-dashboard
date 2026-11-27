# fake-subagents.ext.ts — index

pi extension fixture. Test-only FAKE `@blackbelt-technology/pi-dashboard-subagents`. Implements recorded `agent-teams-subagents-contract` on `pi.events` so in-process teams run end to end before gate 1.11. Never installed for normal runs.

Reuses `installSubagentsDouble` + `validCapabilities` from `packages/agent-teams-plugin/src/__tests__/harness/subagents-double.ts` (capabilities, spawn replies, claim rule, slot pool, 1-based queue positions, steer, interrupt, stop, created/started/completed|failed+idle/disposed). No duplicated recorded sequences. Adds only: per-child script, slot promotion, state file, lag probe.

Exports: `configFromEnv`, `parseChildScript`, `busyWait`, `installFakeSubagents(bus, cfg, activation?, {clock?, block?})` → `{double, state(), shutdown()}`, default `fakeSubagents(pi)`.

Load: qa L2 `pi --mode rpc -e qa/fixtures/fake-subagents.ext.ts` on LEAD only. Docker harness `PI_FAKE_SUBAGENTS=1` (test-entrypoint stages re-export wrapper, skips real subagents). Fake + real never coexist (claim rule).

Child script: prompt sentinel `[[fake-run:<ms>|forever|fail:<ms>]]`, `[[fake-block:<ms>]]` (blocks lead loop). Default run `FAKE_SUBAGENTS_RUN_MS` (1500).
Env: `FAKE_SUBAGENTS_MAX_CONCURRENT` (4), `_PROGRESS_MS` (progress `started`, 0=off), `_BLOCK_MS` (one-shot block), `_LAG_PROBE_MS` (loop gap probe), `_STATE_FILE` (JSON: activation, children, event counters, loop gap; `shutdown:true` after `session_shutdown`).

`session_shutdown` disposes every child (`disposed: shutdown`) and uninstalls: a `/reload` leaves 0 children, activation counter +1.

Fidelity boundary: dashboard side only. No child boot cost, tokens, per-child heap. Real package behaviour = task 2.6 drift test + gate 1.11.

L1: `packages/agent-teams-plugin/src/__tests__/fake-subagents-ext.test.ts` (dynamic import by path: fixture is outside the package rootDir). Used by `qa/tests/60-agent-teams-inproc-persistence.sh`, `qa/tests/61-agent-teams-inproc-perf.sh`, faux scenarios `agent-teams-inproc-*`, `agent-teams-bench-*`.

See change: add-agent-teams-in-process (task 2.7, decision B105).
