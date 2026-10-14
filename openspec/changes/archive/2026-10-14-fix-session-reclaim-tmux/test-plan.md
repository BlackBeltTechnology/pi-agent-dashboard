# Test Plan — fix-session-reclaim-tmux

Stage: design   Generated: 2026-08-12

Decisions applied: R1–R7 (design.md *Resolved Questions*).

Harness exemplars (verified on disk):
- terminator unit (new file `packages/server/src/spawn-process/__tests__/session-terminator.test.ts`) ← model on `packages/server/src/__tests__/headless-pid-registry-kill-escalation.test.ts` + `packages/server/src/__tests__/force-kill-handler.test.ts`
- identity stamp ← `packages/server/src/__tests__/memory-session-manager.test.ts`
- reaper ← `packages/server/src/embed-lifecycle/__tests__/idle-reaper.test.ts`, `reclamation-soak.test.ts`
- give-up tracker (new `reclaim-give-up.test.ts`) ← `packages/server/src/embed-lifecycle/__tests__/quiescence.test.ts`
- caps ← `packages/server/src/embed-lifecycle/__tests__/caps.test.ts`
- metrics/health ← `packages/server/src/embed-lifecycle/__tests__/lifecycle-metrics.test.ts`, `packages/server/src/__tests__/health-shape.test.ts`
- shutdown delegate ← `packages/server/src/__tests__/shutdown-orphan-signal.test.ts`, `packages/server/src/browser-handlers/__tests__/session-action-handler.test.ts`
- close-stamp / liveEpoch ← `packages/server/src/__tests__/manual-close-race.test.ts`, `shutdown-window-recovery.test.ts`
- token rung ← `packages/server/src/__tests__/spawn-register-watchdog.test.ts`, `packages/shared/src/__tests__/process-identify.test.ts`
- no-direct-kill invariant ← `packages/shared/src/__tests__/no-direct-process-kill.test.ts`
- automation stop/complete ← `packages/automation-plugin/src/__tests__/routes-stop.test.ts`, `packages/automation-plugin/src/__tests__/engine.test.ts`; real closure extracted to `createAbortSpawnedRun` (design D6 item 3) → new `packages/server/src/spawn-process/__tests__/abort-spawned-run.test.ts`
- L2 Windows ← `qa/tests/28-gateway-windows.ps1`
- L3 tmux process-table ← `tests/e2e/tmux-session-shutdown.spec.ts` (docker exec `/proc` + `tmux list-panes`), `tests/e2e/automation-fanout.spec.ts`
- L2 ← `qa/tests/19-tmux-spawn-injection.sh`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | identity stamp (task 2.1) | EP | L1 | automated | `register({sessionId:"s1", pid:4242})` at fake now=T | register | record `pidRecordedAt === T`; not in persisted meta / protocol payload |
| E2 | identity stamp | EP | L1 | automated | s1 registered at T with pid 4242 | re-register at T+5000 (same or new pid) | `pidRecordedAt === T+5000` |
| E3 | identity stamp | EP (invalid) | L1 | automated | `register` with no `pid` | register | `pid` and `pidRecordedAt` both `undefined` |
| E4 | identity guard boundary | BVA | L1 | automated | `pidRecordedAt=T`; fake `processStartedAt` = T+1999 / T+2000 / T+2001 | `terminate(id,{verifyIdentity:true})`, `signalZero`→alive | 1999,2000 → `killProcess` called; 2001 → `refused-identity`, `killProcess` NOT called, log contains `pid reused` |
| E5 | identity guard | BVA (lower) | L1 | automated | `processStartedAt` = T−3600000 (pi started 1h before register) | terminate unattended | signalled; outcome per post-kill `signalZero` |
| E6 | identity guard unverifiable | EP | L1 | automated | `processStartedAt` → `null` (probe failure) on linux/darwin | terminate unattended, pid alive | `refused-identity`, zero signals, log `identity unverifiable on <platform>` |
| E7 | identity guard win32 | EP | L1 | automated | platform `win32` (start time null), no registry entry, pid alive | terminate unattended | `refused-identity`, zero signals, diagnostic names win32 |
| E8 | identity guard missing stamp | EP | L1 | automated | record has `pid` but no `pidRecordedAt` (fixture) | terminate unattended | `refused-identity`, zero signals |
| E9 | guard scope = session.pid only | decision-table | L1 | automated | registry hit only (no `session.pid`), registry pid start time AFTER any stamp | terminate unattended | registry rung signals (no start-time check); confirm via `signalZero(registryPid)` |
| E10 | restored-entry carve-out (3.11) | EP | L1 | automated | registry entry restored by `cleanupOrphans` (dummy handle), pid recycled | terminate unattended | rung 1 signals it without start-time check (documents declared exemption) |
| E11 | `verifyIdentity:false` (shutdown) | decision-table | L1 | automated | same as E6 (start time null) | `terminate(id,{verifyIdentity:false})` | `killProcess` called — no guard; operator path not regressed on win32 |
| E12 | give-up N=3 (design D4) | BVA | L1 | automated | tracker; outcome `unconfirmed`; no `clear` between calls | `recordFailure` ×2, ×3, ×4 | after 2: not given-up, returns false; 3rd: given-up, returns `true` (crossing) once; 4th: returns `false`; exactly ONE `error` line overall |
| E13 | give-up reset (R3) | state-transition | L1 | automated | 2 failures recorded | `clear(id)` (confirmed termination), then 2 more failures | not given-up (count restarted at 0 by `clear`) |
| E14 | give-up immediate | decision-table | L1 | automated | first failure outcome = `no-identity` / `refused-identity` | `recordFailure` once | given-up immediately, crossing `true` |
| E15 | shared tracker reaper+caps | decision-table | L1 | automated | 2 reaper `unconfirmed` failures for s1 | caps `admit` reclaim of s1 also unconfirmed | s1 given-up (shared count reaches 3); next sweep skips s1; next acquire does not pick s1 |
| E16 | tracker prune | state-transition | L1 | automated | s1 given-up | s1 disappears from `listSessions()`, next sweep | `isGivenUp("s1") === false` (pruned) |
| E17 | Rule L latch not in tracker | decision-table | L1 | automated | `sendStopAfterTurn` → `false` on 5 consecutive sweeps | 5 sweeps | latch attempted all 5 times; `failedReclaims` +5; tracker never given-up; `reaped.stop-after-turn` unchanged |
| E18 | Rule L delivered | EP | L1 | automated | `sendStopAfterTurn` → `true` | sweep | `reaped["stop-after-turn"]` +1, `failedReclaims` +0 |
| E19 | caps victim filter | decision-table | L1 | automated | 2 quiescent candidates A(oldest, given-up), B; at global cap | `admit` | A not signalled; B reclaimed; admitted if B confirmed |
| E20 | caps all given-up | decision-table | L1 | automated | every quiescent candidate given-up; at cap | `admit` | throws `CapacityError` (`code:"EMBED_CAPACITY"`), all-busy message; given-up sessions still counted (cap math unchanged) |
| E21 | observability shape (R2) | EP | L1 | automated | 1 unconfirmed idle, 1 refused phantom, 1 no-identity idle, 1 undelivered latch | GET `/api/health` lifecycle snapshot | `typeof failedReclaims === "number"` and `=== 4` (scalar, no per-reason object); `reaped` all reasons 0 |
| E22 | given-up visibility (R2) | EP | L1 | automated | s1 given-up | GET `/api/health` + captured logs | snapshot has no given-up/unreclaimable field (keys = existing + `failedReclaims` only); exactly one `error` log line names `s1`, reason, outcome, pid |
| E23 | no-identity | EP | L1 | automated | no record pid, no registry entry, no token | terminate | `{outcome:"no-identity", terminated:false}`, zero signals |
| E24 | token rung | EP | L1 | automated | no session record; `findPidsBySpawnToken(tok)` → [p1]; p1 dies on SIGTERM | `terminate(id,{spawnToken:tok})` | `killProcess(p1)` once; `confirmed-dead` |
| E25 | token rung empty | EP | L1 | automated | `findPidsBySpawnToken` → `[]` (win32 or no match) | terminate with token | `no-identity`, zero signals |
| E26 | token rung multi-pid | BVA | L1 | automated | token → [p1,p2]; p1 dies, p2 survives | terminate with token | `killProcess` called for both; outcome `unconfirmed` (never `confirmed-dead` while any matched pid lives) |
| E27 | close stamp applied | state-transition | L1 | automated | live record, no `closedReason` | `terminate(…,{stampManualClose:true})`; bridge `session_unregister` arrives mid-kill; confirmed | ends `closedReason:"manual"`; meta has NO `liveEpoch` |
| E28 | close stamp withdrawn | state-transition | L1 | automated | live record, kill unconfirmed, record not ended | terminate stamped | in-memory `closedReason === undefined` after return |
| E29 | close stamp no-overwrite | EP | L1 | automated | record already `closedReason:"process_gone"` | terminate stamped | reason stays `process_gone`; not withdrawn to undefined |
| E30 | close stamp, record ended | state-transition | L1 | automated | outcome unconfirmed BUT record became `ended` during kill | step 8 | stamp kept (`manual`) |
| E31 | close stamp absent record | EP | L1 | automated | token rung, no record | terminate stamped | no `update` call, no throw |
| E32 | shutdown keeps its steps (D7) | state-transition | L1 | automated | live tmux-style session (no registry, pid set) | `shutdownSession` | call order: `setLiveness` → `update(manual)` → `{type:"shutdown"}` → registry → marker scan → terminate(graceMs=SHUTDOWN_GRACE_MS, verifyIdentity:false) → unregister → `session_removed` once |
| E33 | shutdown no-identity | EP | L1 | automated | session with no pid, no registry | shutdown | `console.warn` contains session id + "termination NOT verified"; `session_removed` once; NO `session_orphaned` |
| E34 | shutdown double | state-transition (illegal) | L1 | automated | session already exited (`signalZero`→esrch) | shutdown twice | no error; no signal to the pid; `session_removed` once |
| E35 | one terminator invariant | structural | L1 | automated | source of `idle-reaper` injection, caps binding, `abortSpawnedRun`, `shutdownSession` | static scan (`server.ts`, `session-action-handler.ts`) | each resolves through `terminate(`; no bare `headlessPidRegistry.killBySessionId`/`killByToken` at these sites → test fails otherwise |
| E36 | no direct process.kill | structural | L1 | automated | `session-terminator.ts` | `no-direct-process-kill.test.ts` scan | module passes (signals only via `killProcess`; `signalZero` permitted per existing allowlist) |
| E37 | force-kill untouched | regression | L1 | automated | existing `force-kill-handler.test.ts` | run | passes unchanged; order pid-first then registry |
| E38 | ineligible sweep does not reset give-up (R3) | state-transition | L1 | automated | reaper; s1 terminate → `unconfirmed`; sweep 1 fail, sweep 2 fail, sweep 3 s1 ineligible (browser subscribed, no attempt), sweep 4 fail | 4 sweeps | after sweep 4 s1 given-up (3 attempts counted across the gap); sweep 5 makes no attempt; exactly 3 `terminate` calls |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D2 reaper `graceMs:0` (no 1.5 s advisory wait) | threshold (fn-level, timed) | L1 | automated | 1 reap, fake process exits on SIGTERM | terminate wall-time with fake timers: no `SHUTDOWN_GRACE_MS` wait — `killProcess` entered at t=0 | single call |
| P2 | given-up sessions get no further kill attempts (R4) | invariant (count, no latency) | L1 | automated | 10 ephemeral sessions all `unconfirmed` | count `terminate` calls per sweep — sweeps 1–3: 10 each; sweeps 4+: 0 (no latency threshold, R4) | 5 sweeps |
| P3 | headless double-probe cost (Risks B-F12) | invariant | L1 | automated | headless registry hit, process gone after registry kill | count primitives | exactly 1 `signalZero`, 0 extra `killProcess` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | orphan signal surfaced (unchanged req) | convergence | L1 | automated | client receives `session_orphaned {sessionId,pid}` after `session_removed` | message handler | surfaces pid (exemplar `packages/client/src/hooks/__tests__/useMessageHandler.session-orphaned.test.tsx`) — regression only |
| F2 | reaped session card reason | state-transition | L1 | automated | **Deviation (user-approved at ship-it):** L3 dropped — the harness cannot produce a persistent `ephemeral` tmux session (the automation engine terminates a run's session at completion; a live run is never reap-eligible). Covered by E27 (stamped reap ends `manual`, no `liveEpoch` ⇒ not a recovery candidate) | stamped reap | card converges to ended/`manual`; no `liveEpoch` persisted |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | registry miss leak (task 1.1/1.3 repro) | fault-injection (abort) | L1 | automated | no registry entry; `session.pid` live, verified | reaper gear 1 terminate | `killProcess(session.pid)` called; `signalZero`→esrch ⇒ `confirmed-dead`; `onReap("idle")` once |
| X2 | registry "issued" ≠ dead (1.2) | fault-injection | L1 | automated | registry `killBySessionId` → `true` but `killProcess` `{ok:false}`; pid still alive | terminate | `outcome:"unconfirmed"`, `pid` reported; `onReap` NOT called; `failedReclaims` +1 |
| X3 | registry hit, no session.pid | fault-injection | L1 | automated | registry pid captured via `getPid` before kill, survives | terminate | `unconfirmed`, `pid === registryPid` |
| X4 | already gone | state-transition | L1 | automated | `signalZero(pid)` → esrch at step 3 | terminate unattended | `confirmed-dead`, zero `killProcess` calls, identity guard NOT consulted |
| X5 | dies between liveness and identity | race | L1 | automated | step3 alive; `processStartedAt` null; re-probe esrch | terminate unattended | `confirmed-dead`, zero signals (not `refused-identity`) |
| X6 | EPERM-live (3.10) | fault-injection | L1 | automated | `signalZero` → `other-errno`; `killProcess` → `{ok:false}` no signal | terminate | `unconfirmed`, never `confirmed-dead`; `isProcessAlive` unmodified |
| X7 | terminator throws | fault-injection (abort) | L1 | automated | injected `terminate` rejects | sweep | treated as `unconfirmed`: failure log w/ session+reason, `failedReclaims` +1, tracker `recordFailure`; NOT only the generic sweep-level warn |
| X8 | failed reap is loud | fault-injection | L1 | automated | unconfirmed gear-1 | sweep | log `[embed-lifecycle] reclaim(<id>, idle): unconfirmed, process <pid> survived`; record still listed; no `session_orphaned`, no unregister |
| X9 | retry next sweep | state-transition | L1 | automated | sweep 1 unconfirmed, session still eligible | sweep 2 | terminate attempted again |
| X10 | refused-identity immediate stop | state-transition | L1 | automated | reused pid (E4 2001 case) | sweeps 1..3 | 1 attempt, then 0; one `error` line naming id, reason, outcome, pid |
| X11 | phantom on non-headless | fault-injection | L1 | automated | phantom-eligible, no registry entry, verified pid | gear 3 | ladder SIGTERM→2s→SIGKILL via `killProcess` (no bare SIGKILL); `reaped.phantom` +1 on confirm |
| X12 | caps unconfirmed refuses | fault-injection | L1 | automated | at cap; victim terminate → `unconfirmed` | `admit` | throws `CapacityError` `EMBED_CAPACITY`, message contains "could not be confirmed"; exactly 1 terminate call (no 2nd victim); `reclaimGuard` released |
| X13 | caps non-headless confirmed | fault-injection | L1 | automated | victim no registry entry, verified pid | `admit` | terminate called with `{verifyIdentity:true, stampManualClose:true}`; admitted |
| X14 | automation graceful branch escalates (D6) | fault-injection | L1 | automated | tmux-style run (no registry), `graceful:true`, bridge WS closed (hint undeliverable); pid dies on SIGTERM | `abortSpawnedRun` | hint attempted, then `terminate(sid,{spawnToken,verifyIdentity:true,stampManualClose:true})`; pid killed; returns `true`; `failedReclaims` +0, no warn |
| X15 | automation pre-register window (R1) | fault-injection | L1 | automated | no session record; case a: token → [p1] (dies); case b: token → `[]` | stop run | a: p1 terminated via token rung, registry `undefined` does not end attempt, returns `true`; b: returns `false`, one `console.warn` naming the spawn token + `no-identity`, `failedReclaims` +1 |
| X16 | automation win32 non-headless (R1, R5) | EP | L1 | automated | platform win32, record pid, no registry | run complete | zero signals; returns `false`; one `console.warn` naming session id + `refused-identity`; `failedReclaims` +1; give-up tracker untouched |
| X17 | completion idempotent | state-transition (illegal) | L1 | automated | run completes, terminate makes bridge send `session_unregister` | finalize | run finalized once; one run record (exemplar `routes-stop.test.ts` / `engine.test.ts`) |
| X18 | tmux reap real process (systematic-debugging acceptance) | fault-injection | L1 | automated | **Deviation (user-approved at ship-it):** L3 dropped for the same reason as F2. The registry-miss reap is covered by X1/X8–X11 (L1, reaper → terminator on a registry-less verified pid) and the real-process half by X19 (L3, same terminator via the automation stop path) | reaper gear 1 on a registry-less pid | `killProcess(session.pid)` called, `confirmed-dead`, `onReap` once; `failedReclaims` 0 |
| X19 | tmux automation stop real process | fault-injection | L3 | automated | docker harness tmux default; automation run spawned | stop run via route | container `/proc/<pid>` absent after finalization |
| X20 | tmux automation stop pre-register | race | L3 | automated | stop issued before `session_register` lands (harness delay hook) | stop | no pi with run's token in container `ps` |
| X21 | Windows wt/wsl-tmux unattended reclaim refused | EP | L2 | automated | Windows VM, `wt` session ephemeral, embedLifecycle enabled | reap | pi still resident; server log has `identity unverifiable on win32`; `failedReclaims` ≥1 (`qa/tests/*.ps1`, new) |
| X22 | process-group gap issue filed (8.4) | — | — | manual-only | GitHub | task 8.4 | [judgment: issue exists and linked from design Risks — no test observable] |
| X23 | automation unconfirmed report (R1) | fault-injection | L1 | automated | linux, record pid verified, no registry; `killProcess` `{ok:false}`, pid survives | `abortSpawnedRun({sessionId})` | returns `false`; one `console.warn` naming session id, `unconfirmed`, pid; `failedReclaims` +1; give-up tracker untouched |

---

## Coverage summary

- Requirements covered: 14/14 delta requirements (force-kill-handler 6, embed-session-lifecycle 4, automation-run-lifecycle 1, shutdown-session-recovery 1, + identity stamp, shutdown delegation)
- Scenarios by class: edge 38 · perf 3 · frontend 2 · error 23
- Scenarios by level: L1 62 · L2 1 · L3 2 (X19, X20) · ci 0 · — 1
- Scenarios by disposition: automated 65 · manual-only 1

## New infra needed

- ~~Docker e2e harness `embedLifecycle` override for X18/F2~~ — dropped (user-approved deviation): no harness path yields a persistent `ephemeral` session without a test-only production hook.
- `abortSpawnedRun` is an inline closure in `server.ts` → extracted to `createAbortSpawnedRun` (design D6 item 3) so X14–X16, X23 are unit-testable.
- X20 needs a harness hook delaying `session_register` (or a deterministic pre-register window).
- X21 needs a Windows qa `.ps1` that enables the reaper; none exists today.
