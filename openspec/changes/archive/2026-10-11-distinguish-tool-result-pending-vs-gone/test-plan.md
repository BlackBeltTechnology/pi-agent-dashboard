# Test Plan — distinguish-tool-result-pending-vs-gone

Stage: design   Generated: 2026-10-11 (revised after doubt-review cycle 2: `410` comes only from the evicted-end record; `202` is a cosmetic hint)

Hard gate passed: every Triple fills from the delta specs and design D1–D7. No clarifications are open.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | dashboard-server route → evicted-end record (per-session trim) | fault-injection (trim) | L1 | automated | store with a small per-session byte cap; real ends for `a`, `b` stored, a synthesized end `{c, healedBy:"session_ended"}` stored, an end with a 300-char id stored, then filler to trim all of them | `insertEvent` past the cap | `wasToolEndEvicted` true for `a` and `b`; false for `c`, for the 300-char id, and for a never-stored id |
| E1b | dashboard-server "A live start invalidates a recorded eviction" | state-transition | L1 | automated | `a` in the record | live top-level `tool_execution_start{a}` ingested | `wasToolEndEvicted(s,"a") === false`; route `?pending=1` → `202` |
| E2 | same (global reclaim path) | fault-injection (global budget, all pinned) | L1 | automated | every session pinned; global budget exceeded | the `dropNonEssentials` fallback runs | dropped ends are recorded in their own session's record |
| E3 | dashboard-server "Evicted-end record is bounded" | BVA (capacity, capacity+1) | L1 | automated | 513 ends dropped for one session | trims | record size is 512; the first dropped id is gone, the last is present |
| E4 | same (freed with the buffer) | state-transition | L1 | automated | record holds `a`; then (i) `deleteEventsForSession(s)`, (ii) LRU eviction of `s` | each path | `wasToolEndEvicted(s,"a") === false` after each |
| E5 | dashboard-server in-flight hint | state-transition + BVA | L1 | automated | empty hint | `observeLive` start `a` → end `a`; nested start `n`; start `a` then `agent_settled`; `clear(s)` with `t` present; 257 starts | `a` true then false; `n` never; `agent_settled` empties `s` and removes its entry; `clear` leaves `t`; at most 256 ids held |
| E6 | same (replayed events ignored) | fault-injection (reconnect orphan-close) | L1 | automated | live start for `a`; then `session_register`, then a replayed `tool_execution_end{a}` and a replayed `agent_settled` before `replay_complete` | event-wiring forward handler | the hint changes only through the register's `clear`; no `observeLive` call for replayed events; session end and session removal each clear `s` |
| E7 | dashboard-server "Completed tool call returns full result" (regression guard) | equivalence partition | L1 | automated | stored end for `abc` (1000 lines) | `GET …/abc` | `200 {result, isError:false}` |
| E8 | dashboard-server "Tool call evicted from memory buffer" | decision-table | L1 | automated | `abc` in the evicted-end record, no stored end | `GET …/abc` and `GET …/abc?pending=1` | both `410 {error:"result no longer available"}` |
| E9 | dashboard-server "Re-stored end wins over the eviction record" | decision-table | L1 | automated | `abc` in the record AND a stored end | `GET …/abc` | `200` |
| E10 | dashboard-server "Tool call still in flight" + "Pending flag is exact" | decision-table | L1 | automated | `abc` in the hint | `?pending=1`; no flag; `?pending=true`; `?pending=0` | `202 {pending:true}`; `404`; `404`; `404` |
| E11 | dashboard-server "In-flight answer survives a trimmed start" | fault-injection | L1 | automated | `abc` in the hint; its stored start trimmed | `?pending=1` | `202` |
| E12 | dashboard-server "Unknown session" + owner gate | equivalence partition | L1 | automated | (a) unknown session; (b) known session, principal rejected by `gateHttpSession` while `abc` is in the record | `?pending=1` | (a) `404`; (b) the gate's rejection, never `410`/`202` |
| E13 | design D6 | state assertion | L1 | automated | one `202` and one `410` answered | `GET /api/health` | `toolResult` deep-equals `{pending:1, gone:1}`; prior fields unchanged |
| E14 | incremental-event-sync reconcile (request shape) | state assertion | L1 | automated | `running` row older than `STALE_TOOL_MS` | tick | the URL ends `/tool-result/<id>?pending=1` |
| E15 | same → "Genuinely slow tool is not falsely completed" | state-transition | L1 | automated | fetch → `202 {pending:true}`; no later inference | 3 re-armed ticks | row `running`; no end reduced; `{pending:true}` never applied as a result |
| E16 | same → "Server-vouched eviction is finalized immediately" | state-transition | L1 | automated | fetch → `410` | 1 tick | row `complete`, `healedBy:"result_evicted"`, body "result no longer available" on that tick; heal counter +1; no further fetch for that row |
| E17 | same → "Evicted result is finalized by supersede" (404 unchanged) | state-transition | L1 | automated | fetch → `404` ×2; later assistant `message_start` | ticks | superseded heal after the 2nd `404` (unchanged) |
| E18 | Superseded heal → "Pending answers alone never finalize a running tool" | BVA | L1 | automated | fetch → `202` ×10; no later inference | ticks | the heal never fires; row `running` |
| E19 | Superseded heal → "A stale pending hint cannot strand a finished tool" | state-transition | L1 | automated | fetch → `202` ×2; later assistant `message_start` | ticks | row healed with `healedBy:"superseded"` |
| E20 | Superseded heal → "Recovery still preferred" (eviction variant) | state-transition | L1 | automated | row healed `result_evicted`; then (a) a real end; (b) another synth | `reduceEvent` | (a) real result overwrites; (b) ignored |
| E22 | reconcile → "Server-vouched eviction is finalized immediately" (badge) | state assertion | L1 | automated | a `ToolCallStep` row with `healedBy:"result_evicted"` | render | the eviction badge renders (distinct text from the superseded badge) |
| E21 | bash-execution "Evicted result shows inline notice" | equivalence partition | L1 | automated | fetch → `410 {error:"result no longer available"}`; also `404 {error:"tool call still in flight or unknown"}` | `fetchFull()` | `error === t("tool.resultEvicted")` in both cases; never the raw body text |

### Performance

None. Recording an id is O(1) amortised, and the hint costs O(1) per event. E3/E5 cover the bounds.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | proposal Why (no red noise for long tools) | visual | — | manual-only | running dashboard; a session runs `sleep 60` | human watches DevTools → Network | [judgment: probes answer `202 {pending:true}`, no red rows; `/api/health` `toolResult.pending` grows. E10/E14/E15 automate each half] |

### Error-handling

The fault-injection rows (E1, E2, E6, E11) are filed under Edge-case.

---

## Coverage summary

- Requirements covered: 4/4. dashboard-server route by E1–E13; reconcile by E14–E17; superseded heal by E18–E20; bash-execution full output by E21.
- Scenarios by class: edge 23 · perf 0 · frontend 1 · error (in edge) 4
- Scenarios by level: L1 23 · manual 1
- Scenarios by disposition: automated 23 · manual-only 1

## New infra needed

- None. Exemplars:
  - `packages/server/src/__tests__/` store tests (`grep -rln "trimBufferToLimit\|getTrimStats" packages/server/src`);
  - `packages/server/src/session/__tests__/open-tool-calls.test.ts`;
  - `packages/server/src/__tests__/recovery-e2e.test.ts`;
  - `packages/server/src/__tests__/session-routes-tool-result.test.ts`;
  - `packages/server/src/__tests__/health-shape.test.ts`;
  - `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts`;
  - `packages/client/src/lib/__tests__/event-reducer.stuck-tool-baseline.test.ts`;
  - `packages/client/src/hooks/__tests__/useToolFullResult.test.ts`.
