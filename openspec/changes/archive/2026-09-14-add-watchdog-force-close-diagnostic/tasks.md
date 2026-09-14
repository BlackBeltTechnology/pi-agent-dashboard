# Tasks — add-watchdog-force-close-diagnostic

## 1. Protocol

- [x] 1.1 Widen `BridgeDiagnosticEvent` in `packages/shared/src/protocol.ts` with `"watchdog_force_close"`, documenting why a client-initiated close is otherwise indistinguishable from a drop or a reap.

## 2. ConnectionManager reporting

- [x] 2.1 Export `WatchdogFireInfo` from `packages/extension/src/connection.ts` with `silentForMs`, `watchdogTimeout`, `readyState`, `inboundQueueDepth`, `refusedInbound`, `maxTickDriftMs`.
- [x] 2.2 Add the optional `onWatchdogFire` option and invoke it in `startWatchdog` BEFORE `handleDisconnect()`, wrapped in try/catch so a throwing reporter cannot block the teardown it describes.
- [x] 2.3 Measure the watchdog's own check-tick lateness (`watchdogLastTickAt` → `watchdogMaxTickDrift`), reset when the watchdog starts, and report the worst value as `maxTickDriftMs`.
- [x] 2.4 Document on `inboundQueueDepth` that it holds PARSED frames and therefore stays 0 under a blocked loop — it is not a starvation probe.

## 3. Bridge wiring

- [x] 3.1 Add `formatWatchdogFire(w)` in `packages/extension/src/bridge.ts` and wire `onWatchdogFire` on the primary `ConnectionManager`, recording via `transportDiagnostics` plus a `console.log`.
- [x] 3.2 Wire the same reporter on the `/dashboard-connect` move-target `ConnectionManager`, which `connection` is rebound to (test-plan: known gap, carried by review).
- [x] 3.3 Do NOT instrument the heartbeat timer's `!isActive()` arm — `initBridge` clears `prev.timers` before bumping `generation`, so the arm is unreachable and a counter there could only ever report 0. Record that reasoning in the `bridge.ts` DOX row.

## 3b. Poll-phase fix

- [x] 3b.1 Extract `isSilentPastThreshold()` so the tick check and the deferred re-check cannot drift apart.
- [x] 3b.2 Defer the force-close by one loop turn (0 ms timer) and re-evaluate before closing; guard with `watchdogRecheckPending` (at most one deferral per detection) and bail if the watchdog stopped meanwhile.
- [x] 3b.3 Use `setTimeout(…, 0)` rather than `setImmediate` — equivalent at runtime (both re-enter after poll), but vitest's fake timers never run `setImmediate`, which would make the defect untestable at unit level.
- [x] 3b.4 Absorb the one-turn deferral in existing fake-timer tests (`advance()` helper in `watchdog.test.ts`; #X5 in `bridge-liveness-heal.test.ts`).

## 4. Tests

- [x] 4.1 E1 — force-close reports its cause. Input: manager with `watchdogTimeout` 60 000 + reporter, one message at t=20s · Trigger: tick at t=90s sees 70s silence · Observable: reporter called once, `silentForMs >= 60_000`. See `packages/extension/src/__tests__/watchdog.test.ts` (existing suite, same `MockWebSocket` harness). (test-plan #E1)
- [x] 4.2 E2 — a responsive server produces no report. Input: messages every 20s for 100s · Trigger: every tick · Observable: reporter never called, still connected, 1 socket. See `watchdog.test.ts`. (test-plan #E2)
- [x] 4.3 E3 — reported `readyState` predates teardown. Input: OPEN socket · Trigger: fire at t=60s · Observable: report says `1`, socket ends `3`. See `watchdog.test.ts`. (test-plan #E3)
- [x] 4.4 E4 — no reporter means unchanged behaviour. Input: manager without `onWatchdogFire` · Trigger: fire at t=60s · Observable: force-close + reconnect as before, no throw. See `watchdog.test.ts`. (test-plan #E4)
- [x] 4.5 E5 — healthy loop attributes silence to the peer. Input: timers on schedule · Trigger: fire after 60s silence · Observable: `maxTickDriftMs < 1_000`. See `watchdog.test.ts`. (test-plan #E5)
- [x] 4.6 E6 — blocked loop attributes silence to this process. Input: clock advanced 90s without timers firing · Trigger: the delayed tick · Observable: `maxTickDriftMs >= 85_000`. See `watchdog.test.ts`. (test-plan #E6)
- [x] 4.7 X1 — a throwing reporter blocks nothing. Input: reporter that throws · Trigger: fire at t=60s · Observable: disconnected, and a second socket after the 1s backoff. See `watchdog.test.ts`. (test-plan #X1)
- [x] 4.8 X2 — the diagnostic survives an unsendable moment. Input: `transportDiagnostics` with no sink attached · Trigger: `record()` then `attach()` with a resolvable sessionId · Observable: buffered `watchdog_force_close` flushed on attach. Extended `packages/extension/src/__tests__/transport-diagnostics.test.ts`. (test-plan #X2)

- [x] 4.9 F1 — a live peer is not force-closed. Input: out-of-process peer sending every 100 ms, `watchdogTimeout` 1 000 ms, check interval 200 ms · Trigger: 1 500 ms block inside `onMessage` · Observable: 0 fires, 1 connection, `received > 3`. New `packages/extension/src/__tests__/watchdog-poll-phase.test.ts`; verified RED before the fix (2 fires, `silentForMs: 1500`). (test-plan #F1)

- [x] 4.10 F2 — a genuinely silent peer is still closed. The deferral must not become a way to never close. Covered by E1/E4 running unchanged after the fix (both assert a fire), so no new test; recorded here so the manifest and tasks agree. (test-plan #F2)

## 5. Docs

- [x] 5.1 Update DOX rows for `connection.ts`, `bridge.ts`, `protocol.ts` with the new exports, the both-sites wiring, and the unreachable-arm note.

## 6. Validate

- [x] 6.1 `openspec validate add-watchdog-force-close-diagnostic` passes.
- [x] 6.2 Extension + shared vitest projects green (4222 passed).
- [x] 6.3 Confirm no timing constant changed: `git diff` shows no edit to `DEFAULT_WATCHDOG_TIMEOUT`, `WATCHDOG_CHECK_INTERVAL`, `HEARTBEAT_INTERVAL`, `WS_PING_INTERVAL`, `HEARTBEAT_TIMEOUT`.
- [x] 6.4 (test-plan: manual-only) Observe a real `watchdog_force_close` line in `server.log` under load, and record whether `maxTickDriftMs` is near-zero or large — the outcome selects the follow-up fix.
