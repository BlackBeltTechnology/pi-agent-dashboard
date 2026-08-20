# Test Plan — fix-out-of-band-reload

Stage: design   Generated: 2025-02-14

Clarifications resolved at the HARD gate: compaction gets a real server-side signal (added by this
change); fan-out toast coalescing window = 2000 ms.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Server-side reload dispatch (ladder step 1) | decision-table | L1 | automated | session with live keeper, status `idle` | `dispatchReload(sid)` | `writeRpc(sid, buildPiRpcLine("/__dashboard_reload", …))` called exactly once; `killBySessionId` not called |
| E2 | Server-side reload dispatch (ladder step 2) | decision-table | L1 | automated | no keeper, PID in `headlessPidRegistry`, `isSessionConnected=false` | `dispatchReload(sid)` | respawn path invoked; `writeRpc` not called |
| E3 | Server-side reload dispatch (ladder step 3) | decision-table | L1 | automated | no keeper, no PID (tmux) | `dispatchReload(sid)` | `sendToSession(sid, {text:"/reload"})` called; no kill, no spawn |
| E4 | Server intercepts `/reload` … (PID conjunct) | decision-table | L1 | automated | no keeper, **no PID**, `isSessionConnected=false` (tmux, WS momentarily down) | `dispatchReload(sid)` | `spawnPiSession` NOT called (no second pi process); terminal feedback `error` |
| E5 | Server intercepts `/reload` … (arg forms) | EP | L1 | automated | `"/reload "`, `"/reload now"`, `"/reload"`+1 image, `"/reload"` | browser `send_prompt` | only the exact bare `"/reload"` enters the reload path; the other three forward to the bridge unchanged |
| E6 | Reload feedback keyed `/reload` | state | L1 | automated | keeper dispatch of `/__dashboard_reload` | write succeeds | emitted `command_feedback.command === "/reload"` (not `/__dashboard_reload`); exactly one terminal event |
| E7 | Idempotency (keeper path) | state-transition | L1 | automated | two `dispatchReload` calls <50 ms apart on one keeper session | both fire | two RPC lines written, two terminal feedbacks, zero spawns |
| E8 | Idempotency (fallback path) | state-transition | L1 | automated | fallback respawn in flight, second `/reload` before new PID registered | second call | at most one new pi process spawned |
| E9 | Compaction is observable to the server | state-transition | L1 | automated | session record with compacting flag set | compaction-end signal, then session end | flag cleared on end; a later registration of the same id starts un-flagged |
| E10 | pi-core update requires a runtime swap | decision-table | L1 | automated | headless session, connected, `status:"streaming"` | `piCoreUpdater.onAllComplete` | respawn invoked (streaming guard does NOT block); `writeRpc` not called |
| E11 | pi-core update … cannot be swapped | decision-table | L1 | automated | session with no `sessionFile`, or non-headless | `onAllComplete` | terminal `command_feedback` `status:"error"`; no success emitted |
| E12 | Enumerated trigger sources (target set) | EP | L1 | automated | 3 sessions: connected+keeper, keeper-only (bridge dead), tmux | fan-out (`reloadConnectedSessions`) | all three targeted; the keeper-only session is not skipped |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Reload feedback is truthful, singular | state-transition | L3 | automated | dashboard open on a headless session | click the reload button | chat converges to exactly one terminal `/reload` pill (never stuck `in progress`), and the session card does not enter `ended` permanently |
| F2 | Server-side reload dispatch (no termination) | state-convergence | L3 | automated | headless session in the docker harness, PID recorded before | reload button | after convergence the pi PID is unchanged; session reachable by a follow-up prompt |
| F3 | Every in-process reload flaps the session record | state-transition | L3 | automated | headless session visible on the board | reload | card may disappear/reappear but converges to `active`; accumulated token/cost fields survive the re-register |
| F4 | `/reload` on streaming session is rejected | state-transition | L3 | automated | session mid-stream in the harness | reload button | one `/reload` pill with `error` + wait-for-response wording; stream completes normally afterwards |
| F5 | Fan-out feedback volume | threshold | L3 | automated | 5 sessions connected | package-install fan-out | toasts coalesced by `command` within a 2000 ms window (≤1 `/reload` toast), while 5 per-session feedback events exist |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Server-side reload dispatch (keeper write fails) | fault-injection (abort) | L1 | automated | `writeRpc` returns `false` | `dispatchReload` on a session WITH a headless PID | respawn fallback taken; exactly one terminal feedback |
| X2 | Server-side reload dispatch (keeper write throws) | fault-injection (abort) | L1 | automated | `writeRpc` rejects | `dispatchReload` on a session with NO PID | terminal `command_feedback` `status:"error"` carrying the reason; no spawn |
| X3 | Connection drops between check and send | fault-injection (abort) | L1 | automated | `isSessionConnected=true` but `sendToSession` returns `false`, PID present | `dispatchReload` | respawn fallback taken (reload not silently dropped) |
| X4 | `/reload` for a bridge-dead session stuck at streaming | state-transition (illegal edge) | L1 | automated | PID present, no keeper, not connected, `status:"streaming"` | `dispatchReload` | respawn proceeds; stale `streaming` does not produce a refusal |
| X5 | Fallback refuses a connected streaming session | state-transition | L1 | automated | connected + streaming, fallback branch reached | `dispatchReload` | no respawn; `command_feedback` `status:"error"` |
| X6 | Bridge reload with no available path | fault-injection | L1 | automated | terminal-hosted bridge, `RELOAD_KEY` absent | `/reload` reaches `command-handler` | emits `error`; emits NO `completed` (guards against the old unconditional `completed`) |
| X7 | `RELOAD_KEY` fast path is single-use | fault-injection (stale ctx) | L1 | automated | captured reload fn whose runner is invalidated → throws **synchronously** | second `/reload` on the same process | error reported (not an uncaught throw); one terminal `error` feedback |
| X8 | Busy-session refusal (compaction) | state-transition | L1 | automated | session flagged compacting | `dispatchReload` | no keeper write, no respawn; `error` feedback with the wait wording |
| X9 | Reload dispatched to a session whose extension is disabled | fault-injection | L1 | automated | headless pi spawned with the dashboard extension disabled | `dispatchReload` | documented degradation: the line becomes a user message; server still emits exactly one terminal event (no crash, no duplicate) |
| X10 | Version skew during rollout | fault-injection (mixed versions) | L1 | automated | new server + headless session running the OLD extension | `dispatchReload` via keeper | reload still succeeds (keeper path is independent of new extension code) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Enumerated trigger sources (fan-out) | threshold | L1 | automated | 20 connected headless sessions, one package-install fan-out | all 20 dispatched, zero respawns, fan-out returns within 5 s | single run |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Reload feedback (operator legibility) | subjective | — | manual-only | reload toast + chat pill wording | operator reads the refusal text on a busy session | [judgment: wording reads as actionable, not as a crash] |
| M2 | Session-card flap (F3) perceived quality | visual/subjective | — | manual-only | board with ~10 sessions | fan-out reload | [judgment: the disappear/reappear flicker is tolerable, not alarming] |

---

## Coverage summary

- Requirements covered: 8/8 (4 ADDED incl. compaction signal, 4 MODIFIED)
- Scenarios by class: edge 12 · perf 1 · frontend 5 · error 10 · manual 2
- Scenarios by level: L1 22 · L2 0 · L3 5 · — 2
- Scenarios by disposition: automated 28 · manual-only 2

## Level re-routing at implementation time

**#X9, #X10, #P1 moved L2 → L1.** They were routed to `qa/tests/09|02|03.sh`, but that layer is
clean-install / runtime VM smoke: no dashboard, no RPC keeper, no pi session to dispatch into.
Scenarios placed there could not have observed what they assert. Every observable the three name
is server-side — "the server still emits exactly one terminal event" (#X9), "the keeper path is
independent of new extension code" (#X10), "all N dispatched, zero respawns, within budget"
(#P1) — so they are implemented in
`packages/server/src/__tests__/dispatch-reload-rollout.test.ts`. The half of #X9 that is not
server-observable (pi turning the dispatched line into an ordinary user message when no command
is registered) is pi's own behaviour and is out of this change's reach.

**#F4, #F5 deferred.** The L3 file covers #F1–#F3 (the convergence claims that fail on a revert).
#F4 (streaming refusal wording) and #F5 (toast coalescing within 2000 ms) are timing-shaped
against a live harness stream and are tracked as follow-up e2e work; their server-side halves are
covered at L1 by #X5 / #X8 and by the fan-out target-set test.

## New infra needed

None. L1 → existing vitest suites in `packages/server/src/**/__tests__/` and
`packages/extension/src/__tests__/`; L3 → `tests/e2e/*.spec.ts` against the
docker harness port from `.pi-test-harness.json` (`dashboardPort`, never hardcoded).
