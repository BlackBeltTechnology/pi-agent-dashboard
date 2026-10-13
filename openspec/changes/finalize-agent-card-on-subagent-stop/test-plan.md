# Test Plan — finalize-agent-card-on-subagent-stop

Stage: design   Generated: 2026-10-12

No clarifications needed. Every Triple below resolves from the spec deltas and design D1–D6:
- sentinel strings: D1;
- eligibility: D2;
- update-guard keys: D5;
- badge condition: D6;
- stale-reconcile timing: existing `STALE_TOOL_MS` 25s / `RECONCILE_REARM_MS` 15s.

Baseline: spike `zz-spike-subagent-stop.test.ts` (throwaway, deleted before commit) reproduced gaps G1–G5 on `develop` at planning time. G4 (`currentTool`) is out of scope for this change.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | subagent-stop finalizes | state-transition | L1 | automated | 3 running Agent rows A/B/C, each `toolDetails.agentId` set, no end for A | `subagent_completed{id:ag-A, result:"done A"}` | A: `toolStatus:"complete"`, `toolDetails.status:"completed"`, `result:"done A"`, `healedBy:"subagent_stopped"`, `toolCalls.get(A).status:"complete"`; B, C rows and map entries unchanged (`running`) |
| E2 | subagent-stop finalizes (failure) | state-transition | L1 | automated | running Agent row for ag-X | `subagent_failed{id:ag-X, error:"boom"}` | `toolStatus:"error"`, `toolDetails.status:"error"`, `toolDetails.error:"boom"`; `result` not the last tick text |
| E3 | non-empty fallback | BVA (empty result) | L1 | automated | running row whose last tick `result:"X working"` | `subagent_completed{id:ag-X}` with result `undefined`, then separately with `""` | both: `result:"subagent finished"`, never `"X working"` |
| E4 | non-empty fallback (failure) | BVA (empty error) | L1 | automated | running row for ag-X | `subagent_failed{id:ag-X}` with no error | `toolStatus:"error"`, `result:"subagent failed"` |
| E5 | agent id learned after stop | state-transition | L1 | automated | running Agent row with no `agentId`; `subagent_completed{id:ag-X, result:"r"}` already applied | `tool_execution_update` giving the row `details.agentId:"ag-X", status:"running"` | row `complete`, `result:"r"`, `healedBy:"subagent_stopped"` |
| E6 | marker passthrough | decision table | L1 | automated | running row for ag-X, sub ag-X `running` | `subagent_failed{id:ag-X, healedBy:"session_ended", error:"parent session ended"}` | row `error`, `toolDetails.healedBy:"session_ended"` |
| E7 | heal-marked terminal event ignored | decision table | L1 | automated | sub ag-X already `completed`, row for ag-X still `running` | `subagent_failed{id:ag-X, healedBy:"session_ended"}` | row still `running`; sub still `completed` (existing early-break) |
| E8 | terminal row untouched | state-transition (illegal edge) | L1 | automated | Agent row already `error` via its real end, `result:"real err"` | `subagent_completed{id:ag-X, result:"ok"}` | row still `error`, `result:"real err"`, no `healedBy` |
| E9 | no matching row | EP | L1 | automated | no row carries ag-Z | `subagent_completed{id:ag-Z}` | `messages` and `toolCalls` deep-equal to before; `subagents.get(ag-Z).status:"completed"` |
| E10 | eligibility (elided) | decision table | L1 | automated | Agent row with `toolStatus:"elided"`, `agentId:ag-X`, no `toolCalls` entry | `subagent_completed{id:ag-X}`, then `agent_settled` | row stays `elided` |
| E11 | settle, neutral | state-transition | L1 | automated | running Agent row for ag-Y, sub ag-Y `running` (or absent) | `agent_end` then `agent_settled` | row `toolStatus:"complete"`, `toolDetails.status:"completed"`, `result:"subagent stopped — result not received"`, `healedBy:"turn_settled"`, `resultMissing:true`; `toolCalls.get(id).status` still `"running"`; `subagents.get(ag-Y).status` not `"completed"` |
| E12 | settle, known result | decision table | L1 | automated | running row with `agentId:ag-Y`; sub ag-Y `completed` with `result:"done B"`, constructed with the row not finalized (row linked without passing through the update arm) | `agent_settled` | row `complete`, `result:"done B"`, `healedBy:"turn_settled"`, no `resultMissing` |
| E13 | settle, known failure | decision table | L1 | automated | running row; sub ag-Y `failed`, `error:"x"` (row not finalized, as E12) | `agent_settled` | row `error`, `toolDetails.error:"x"` |
| E14 | agent_end alone | state-transition (illegal edge) | L1 | automated | running Agent row | `agent_end` only | row still `running` |
| E15 | settle scope | EP | L1 | automated | running `bash` row + running Agent row | `agent_settled` | bash row unchanged (`running`); Agent row finalized |
| E16 | sibling isolation under settle | invariant | L1 | automated | 3 running Agent rows: A sub `completed` (`"a"`), B sub `failed` (`"b"`), C unknown | `agent_settled` | A complete `"a"`; B error `"b"`; C neutral sentinel + `resultMissing`; each row's fields come only from its own subagent |
| E17 | real end overwrites heal | state-transition | L1 | automated | row healed by `subagent_completed` (`"done A"`) | real `tool_execution_end{result:"real A"}` | `result:"real A"`, no `healedBy`, no `resultMissing` |
| E18 | real end clears heal-only fields | state-transition | L1 | automated | row neutral-settled (`resultMissing:true`), toolCalls `running` | real `tool_execution_end` without `details` (stale reconcile shape) | `toolStatus:"complete"`, `result` = real body, no `healedBy`, no `resultMissing`; toolCalls `complete` |
| E19 | duration determinism | invariant | L1 | automated | row `startedAt:1000` | `subagent_completed` with `timestamp:4000` | `duration:3000`, independent of wall clock (run with `vi.setSystemTime` far in future) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | normal ordering + trailing tick | state-convergence | L1 | automated | running row for ag-X | `subagent_completed{ag-X}` → `tool_execution_update{details.status:"running", content:"late"}` → real end | after each step: card status never `running`; final: real result, no `healedBy` |
| F2 | no reopen after subagent known finished | state-transition | L1 | automated | row completed by real end; sub ag-X `completed` | `tool_execution_update{status:"running", content:"late", toolUses:9}` | `toolDetails.status:"completed"`, `result` unchanged, `toolDetails.toolUses:9` (non-terminal fields still apply) |
| F3 | settle heal is sticky | state-transition | L1 | automated | neutral-settled row | `tool_execution_update{status:"running"}` | `toolDetails.status:"completed"`, sentinel `result`, `resultMissing:true` kept |
| F4 | orphan-close still reopenable | state-transition | L1 | automated | row closed by `tool_execution_end{healedBy:"session_ended"}`, sub not terminal | `tool_execution_update{status:"running"}` | `toolDetails.status:"running"` (pre-existing behaviour preserved) |
| F5 | reducer replay idempotency | invariant | L1 | automated | any stream from E1, E11, F1 | reduce the stream twice from `createInitialState()` | deep-equal end states |
| F6 | collapse parity | invariant | L1 | automated | stream `start, tick p, subagent_completed, tick s (running), end(no details)` and the same stream with `p` removed (server collapse) | reduce both | equal `toolStatus`, `toolDetails.status`, `healedBy`, `result` on the row |
| F7 | card renders healed completion | EP | L1 | automated | `AgentToolRenderer` with `toolStatus:"complete"`, `toolDetails:{status:"completed", healedBy:"subagent_stopped"}`, sub result `"done A"` | render | no spinner (`agent-activity-row` absent); `"done A"` visible |
| F8 | card renders healed failure | EP | L1 | automated | `toolDetails:{status:"error", error:"boom", healedBy:"subagent_stopped"}` | render | error branch with `"boom"`; no spinner |
| F9 | recovered badge decision | decision table | L1 | automated | `ToolCallStep` × {`resultMissing:true` + no sub result; `resultMissing:true` + sub result; `healedBy:"session_ended"`; `healedBy:"subagent_stopped"`; `turn_settled` without `resultMissing`} | render | badge present, absent, present, absent, absent respectively |
| F10 | resync cadence stops on finalized card | state-transition | L1 | automated | expanded `AgentToolRenderer`, row `toolStatus:"complete"` (neutral), sub `status:"running"` | advance timers 60s | zero `subagent_resync_request` sends |
| F11 | parallel card finishes early under a dropped end | state-convergence | L3 | automated | `[[faux:fanout-width]]` parallel subagents; `routeWebSocket` drops the first-finishing Agent call's `tool_execution_end` frame | run | that card shows done within 5s of its `subagent_completed` frame (well under the 25s stale reconcile), with no `tool-superseded-badge`; every sibling card ends done |
| F12 | visual check of the three terminal shapes in the real UI | visual/subjective | — | manual-only | live dashboard, 3 parallel subagents | look | done / error / "result not received + recovered" cards read correctly, light + dark |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | settle backstop when all stop frames shed | fault-injection (abort) | L1 | automated | end and `subagent_completed` for A never delivered | `agent_settled` | A neutral-finalized (no spinner), recovered badge condition true |
| X2 | neutral heal → stale reconcile recovers the real result | fault-injection (abort + recovery) | L1 | automated | neutral-settled row, toolCalls `running`, `startedAt` 30s ago | `useStaleToolReconcile` tick with fetch stubbed 200 `{result:"done C"}` | row `result:"done C"`, no `healedBy`/`resultMissing`; toolCalls `complete` |
| X3 | neutral heal + reconcile 404s | fault-injection (abort) | L1 | automated | neutral-settled row; fetch stubbed 404; a later assistant inference applied | two reconcile ticks (≥15s apart) | row superseded-healed (existing path), never back to spinning |
| X4 | malformed subagent terminal event | EP (invalid) | L1 | automated | running Agent row | `subagent_completed` with `id` missing / non-string | no row changes; no throw |

---

## Coverage summary

- Requirements covered: 4/4 (3 ADDED in `subagent-live-detail-reliability`, 1 MODIFIED in `agent-tool-rendering`), every listed scenario mapped.
- Scenarios by class: edge 19 · perf 0 · frontend 12 · error 4
- Scenarios by level: L1 33 · L2 0 · L3 1
- Scenarios by disposition: automated 34 · manual-only 1

## New infra needed

- None. F11 reuses `[[faux:fanout-width]]` plus the `routeWebSocket` frame-drop pattern from `tests/e2e/reconcile-heal.spec.ts`.
