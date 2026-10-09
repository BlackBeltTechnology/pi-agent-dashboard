## Why

The cold-start "Reopen N sessions?" offer never fires after a real PC shutdown or reboot. The
OS signals pi and the dashboard together; pi (≥ #3212 / #5080) handles SIGTERM/SIGHUP
gracefully, emits `session_shutdown{reason:"quit"}`, and the bridge sends `session_unregister`
— so the server stamps every session `live:false` / `ended` ~23 s **before** its own SIGTERM
records `exitIntent:"signal"`. The next boot finds zero candidates. Field evidence (macOS,
2026-10-09): 20 sessions unregistered 22.9–23.1 s before the dashboard exited; offers
since 2026-09-27 = 0. Every offer in the log followed a dashboard OOM crash (pi survived,
never unregistered) — the PC-shutdown path has never worked. `fix-recovery-exit-intent`
task 8.6 verified the signal path by SIGTERMing the server **only**, never pi.

Intended behaviour (unchanged): dashboard restart/quit → pi + rpc keeper keep running and
are picked back up silently; PC shutdown/reboot with running sessions → prompt to reopen.

## What Changes

- **Shutdown-window candidates.** At cold start a session is ALSO a recovery candidate when
  its bridge explicitly unregistered (`closedReason === "unknown"`, `recover !== false`) within **60 s** of its ending boot's recorded exit, and that boot exited
  via `signal` (OS shutdown of the standalone server) or `user-quit` (Electron quit). The
  existing `live:true` path is untouched.
- **Durable end evidence, bridge unregister only.** When the end came from an explicit bridge
  `session_unregister`, the eager `onEnded` liveness write also persists `endedAt` and the
  **ending boot's** `liveEpoch` atomically. Today `setLiveness({live:false})` deletes
  `liveEpoch` and `endedAt` rides the 1 s debounced save, which a fast shutdown can lose
  (observed: `status:"active"`, no `endedAt`). Heartbeat expiry, history/placeholder cleanup,
  relocation, manual close and spawn failure never write it.
- **Dashboard Stop stays manual.** Stop/force-kill stamp `closedReason:"manual"` in memory
  before signalling pi, so the racing bridge unregister cannot relabel it `unknown`.
- **Owner-boot lookup with exit time** in `boot-state.ts` (`{ bootId, exitIntent, at }`, current
  entry or ring).
- **One-shot by consumption.** Cold start removes the evidence as soon as it classifies a
  window candidate, in every mode (`ask`, `auto`, `off`).
- Window candidates flow through the existing pipeline unchanged: keeper/bridge liveness
  retract, grace window, offer/dismiss, `auto` resume (user decision: auto-resumes them too).
- No bridge, pi, protocol, client or Electron change. No new signal handlers anywhere.
- Windows is expected to keep working through the existing `live:true` path (pi is hard-killed
  there and never unregisters); verified only by manual QA.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `shutdown-session-recovery`: cold-start classification gains the shutdown-window candidate
  path; the unregister-time liveness write additionally persists `endedAt` + ending-boot
  `liveEpoch` for explicit bridge unregisters only; a scenario covers the real event order (pi
  unregisters before the server is signalled); the stale "clean stop clears liveness" scenario
  body is corrected.
- `meta-json-session-cache`: `liveEpoch` on a `live:false` sidecar is defined as the ending
  boot; the eager liveness write path accepts and persists `endedAt`; debounced overwrites
  keep `liveEpoch`.

## Impact

- `packages/server/src/event-wiring.ts` — `sessionManager.onEnded` liveness write.
- `packages/server/src/persistence/meta-persistence.ts` — `setLiveness` payload (`endedAt`).
- `packages/server/src/persistence/boot-state.ts` — owner-boot record lookup.
- `packages/server/src/session/memory-session-manager.ts`, `packages/server/src/pi/pi-gateway.ts` — manager-private bridge-unregister tag.
- `packages/server/src/browser-handlers/session-action-handler.ts` — in-memory `manual` before signalling pi.
- `packages/shared/src/recovery-timing.ts` — `RECOVERY_SHUTDOWN_WINDOW_MS`.
- `packages/server/src/server.ts` — cold-start classification loop.
- `packages/shared/src/session-meta.ts` — pure window predicate beside `isRecoveryCandidate`.
- Tests: `packages/server/src/__tests__/` recovery suites; red test replays the 2026-10-09
  order (pi unregisters, then server SIGTERM).
- Known accepted false positive: a session ended by `/quit` or `/reload`, or replaced by
  `/new` `/resume` `/fork`, < 60 s before a PC shutdown or Electron quit is offered (dismissable)
  or, in `auto` mode, resumed.

## Discipline Skills

- `doubt-driven-review` — changes the recovery-candidate rule, a user-visible behaviour with
  real cost (Reopen respawns pi and spends tokens); review before it stands.
- `systematic-debugging` — root cause established from `server.log`, `boot-state.json` and
  `.meta.json` evidence; the red test must reproduce the observed event order first.
- No `security-hardening`, `performance-optimization` or `observability-instrumentation`
  trigger: no untrusted input, no hot path, no new endpoint (one new `[recovery] shutdown-window`
  log line).
