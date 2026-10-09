# Test Plan — fix-recovery-pi-signal-unregister

Stage: design   Generated: 2026-10-09

Hard gate: no unfillable Triple slots (window = 60 000 ms inclusive, intent allowlist
`signal`/`user-quit`, reason allowlist `unknown` — all concrete in design D3).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Cold start › shutdown-window (Δ ≤ 60 s) | BVA | L1 | automated | `{live:false, liveEpoch:B, endedAt:T, closedReason:"unknown"}`, owner boot `{exitIntent:"signal", at:T+Δ}` for Δ ∈ {0, 59 999, 60 000, 60 001} ms | `isShutdownWindowCandidate(s, owner, 60_000)` | `true, true, true, false` |
| E2 | Cold start › absolute difference | BVA | L1 | automated | same session, owner `{exitIntent:"user-quit", at:T−Δ}` for Δ ∈ {5 000, 60 000, 61 000} ms (unregister after `at`) | predicate | `true, true, false` |
| E3 | Cold start › intent allowlist | decision-table | L1 | automated | same session, Δ = 23 000 ms, owner intent ∈ {signal, user-quit, restart, shutdown, ephemeral, idle, null} | predicate | `true` only for `signal`, `user-quit`; `false` for the other five |
| E4 | Cold start › reason / flags | decision-table | L1 | automated | Δ = 23 000 ms, intent `signal`; vary one field: closedReason ∈ {unknown, manual, spawn_failed, process_gone}; `recover:false`; `live:true`; `liveEpoch` absent; `endedAt` absent; owner record `undefined` | predicate | `true` only for the base `unknown` row; `false` for each varied row |
| E5 | Owner-boot lookup (D4) | EP | L1 | automated | `boot-state.json` with current `{bootId:D}` and ring `[C, B, A]` | `resolveExitRecord(B)`, `(D)`, `(Z unknown)` | returns B's `{bootId, exitIntent, at}`; D's current entry; `undefined` |
| E6 | Scenario › OS shutdown where pi unregistered first (field replay) | state-transition | L1 | automated | boot B, 20 registered active sessions with sessionFiles, `reopenSessionsAfterShutdown:"ask"` | each bridge sends `session_unregister` at T; boot B records `signal` at T+23 s; new boot cold-starts and grace window elapses | one `recovery_offer` broadcast containing exactly the 20 session ids; log has 20 `[recovery] <id>: shutdown-window` lines |
| E7 | Cold start › status not consulted | state-transition | L1 | automated | sidecar `{live:false, status:"active", liveEpoch:B, endedAt:T, closedReason:"unknown"}` (debounced `ended` write lost), B = `signal` at T+23 s | cold start | session is a recovery candidate AND restored status is `ended` |
| E8 | Scenario › pre-upgrade sidecars not retroactively offered | EP | L1 | automated | sidecar `{live:false, status:"ended", closedReason:"unknown"}` with no `liveEpoch`, jsonl mtime = T, previous boot `signal` at T+5 s | cold start | not a candidate; no `shutdown-window` log line |
| E9 | Scenario › failed replacement boot does not hide the shutdown | state-transition | L1 | automated | session evidence for boot B (`signal`, Δ 23 s); boot C stamped start then died with `exitIntent:null` before classification (ring `[C, B]`) | boot D cold start | session is a recovery candidate |
| E10 | Scenario › window candidate is offered once | state-transition | L1 | automated | window candidate for boot B; run once per mode ∈ {ask, auto, off} | boot C cold start, then boot D cold start without the session running | at C: candidate (ask/auto) / not collected (off), sidecar has no `liveEpoch` afterwards; at D: not a candidate in all three modes |
| E11 | Off mode consumes evidence | decision-table | L1 | automated | window-qualifying sidecar, `reopenSessionsAfterShutdown:"off"` | cold start | no `recovery_offer`, no spawn, sidecar `liveEpoch` removed |
| E12 | Scenario › end write carries endedAt and the ending boot | state-transition | L1 | automated | session stamped `live:true, liveEpoch:A` in boot A, restored and re-registered in boot B (no activity yet) | bridge `session_unregister` during B, debounced save NOT flushed | `.meta.json` immediately has `live:false, liveEpoch:B, endedAt:<unregister time>, closedReason:"unknown"` |
| E13 | Scenario › non-bridge endings get no ending-boot epoch | decision-table | L1 | automated | running session in boot B | end via each of: heartbeat expiry, reconnect-grace expiry, same-tick history register/unregister (`witnessed:false`), placeholder cleanup, finalize-on-socket-close, `spawn_failed`, `session_moved` | each sidecar `live:false` with NO `liveEpoch` |
| E14 | Re-fire of end write (D2) | state-transition | L1 | automated | session ended by bridge unregister in boot B (evidence written) | (a) `update()` re-fires `onEnded` with reason still `unknown`; (b) `update({closedReason:"process_gone"})` | (a) `liveEpoch:B` and `endedAt` unchanged; (b) `liveEpoch` removed; never a value ≠ B |
| E15 | Restored record never re-stamped | state-transition | L1 | automated | session ended in boot A (evidence A), restored at boot B | `update({status:"ended", closedReason:"process_gone"})` during B | sidecar never carries `liveEpoch:B` |
| E16 | meta-json › endedAt retention + liveEpoch survives debounce | EP | L1 | automated | sidecar `{live:false, liveEpoch:B, endedAt:T}` | (a) `setLiveness(f,{live:false})` without `endedAt`; (b) debounced stats save flushed | (a) `endedAt` = T; (b) `liveEpoch` = B and `endedAt` = T |
| E17 | Tag cleared on register | state-transition | L1 | automated | bridge unregister (`/reload`) then same id re-registers in boot B | heartbeat expiry ends it later in B | sidecar has no `liveEpoch`; `wasEndedByBridgeUnregister(id)` false after register |
| E18 | Scenario › Dashboard Stop racing the bridge unregister stays manual | state-transition | L1 | automated | running session in boot B | `shutdownSession` (and separately `handleForceKill`) where the bridge `session_unregister` is delivered before the server's own unregister | in-memory and on-disk `closedReason:"manual"`; sidecar has no `liveEpoch` |
| E19 | Manager tag privacy | EP | L1 | automated | session ended by bridge unregister | serialize `sessionManager.get(id)` / `session_updated` broadcast | no `endSource` key present |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Invariant › restart picks sessions back up | fault-injection (abort) | L1 | automated | `/api/restart` while 3 sessions `live:true` keep running (no unregister) | replacement boot cold-starts; bridges reattach | zero `recovery_offer`; zero `shutdown-window` log lines |
| X2 | Invariant › Electron quit with pi surviving | fault-injection (abort) | L1 | automated | `/api/shutdown {userQuit:true}`; 2 sessions keep running, never unregister | next boot cold-starts; one bridge reattaches inside grace, one keeper reclaimed | no window candidates; existing path retracts both; no offer |
| X3 | Reload re-activation supersedes evidence | state-transition | L1 | automated | `/reload`: bridge unregister then re-register same id, then an activity event in boot B | boot B records `signal`; next cold start | sidecar `live:true, liveEpoch:B`; candidate exactly once via the `live:true` path (no duplicate entry) |
| X4 | Documented limitation › server dies unrecorded | fault-injection (abort) | L1 | automated | bridge unregisters at T; server SIGKILLed at T+5 s (boot B `exitIntent:null`) | next cold start | not a candidate (no `shutdown-window` line) |
| X5 | Auto mode resumes window candidates once | fault-injection (abort) | L1 | automated | window candidate, `reopenSessionsAfterShutdown:"auto"`, `spawnPiSession` rejects | boot C cold start + grace; then boot D cold start | spawn attempted exactly once at C with `continue`; sidecar `liveEpoch` removed; D does not retry |
| X6 | Real macOS reboot | OS behaviour | — | manual-only | 3 terminal pi sessions mid-idle + standalone server (launchd/daemon) | Apple menu › Restart, then open dashboard | offer lists the 3 sessions; `server.log` shows 3 `shutdown-window` lines with Δ < 60 s |
| X7 | Real Linux reboot | OS behaviour | — | manual-only | 2 tmux-hosted pi sessions + daemonized server, systemd host | `systemctl reboot`, then open dashboard | offer lists both sessions |
| X8 | Real Windows reboot (existing path) | OS behaviour | — | manual-only | 2 pi sessions + standalone server on Windows 11 | Start › Restart, then open dashboard | offer lists both sessions (`live:true` path; no `shutdown-window` lines expected) |
| X9 | Electron OS shutdown | OS behaviour | — | manual-only | Electron app open on macOS with 2 dashboard-spawned sessions | shut down the Mac | next launch offers both; `boot-state.json` prior entry `exitIntent:"user-quit"` |

---

## Coverage summary

- Requirements covered: 4/4 delta requirements (Intentional close, Cold start, Sidecar liveness fields, Eager write path) + 3/3 design-only rules (D2 tag, D4 lookup, D5 consumption)
- Scenarios by class: edge 19 · perf 0 · frontend 0 · error 9
- Scenarios by level: L1 24 · L2 0 · L3 0 · manual 4
- Scenarios by disposition: automated 24 · manual-only 4

Performance: none — cold start adds one pure predicate per scanned session and one atomic write per window candidate; no latency budget is affected.

## New infra needed

- none (L1 exemplars: `packages/shared/src/__tests__/recovery-candidate.test.ts`, `packages/server/src/__tests__/{boot-state,meta-persistence,liveness-stamp-wiring,memory-session-manager,recovery-exit-intent,recovery-e2e,recovery-offer,recovery-reattach-retraction,exit-intent-paths}.test.ts`, `packages/server/src/__tests__/session-action-handler-*.test.ts`)
