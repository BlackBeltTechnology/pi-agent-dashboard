# Tasks

Sections 0-5 were implemented inline in the main session (a live-bug fix, not a
worktree build) and are done. Sections 6-8 come from the doubt-review of the
proposal + delta and from the `test-plan.md` fold; they are NOT yet written.

Test homes and their harness exemplars:

| level | home | exemplar to copy harness glue from |
|---|---|---|
| L1 tracker | `packages/server/src/session/__tests__/host-pressure-tracker.test.ts` | itself |
| L1 gateway | `packages/server/src/__tests__/pi-gateway-host-pressure.test.ts` | itself |
| L1 backpressure | `packages/server/src/__tests__/browser-gateway-host-pressure-reconcile.test.ts` (new) | `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts` |
| L1 client | `packages/client/src/components/session/__tests__/SessionCard.host-pressure.test.tsx` | itself |
| L3 e2e | `tests/e2e/host-pressure-badge.spec.ts` (new) | `tests/e2e/bridge-contention-health.spec.ts` |

## 0. Diagnose (systematic-debugging)

- [x] 0.1 Compare the badge against live server state: `/api/sessions` showed
  `processMetrics` ages of 3–20 s for all 13 live sessions while every card read
  `unresponsive · ~24m`. Concluded the browser copy, not the session, was stale.
- [x] 0.2 Prove the field is never broadcast: `grep -rn "processMetrics"
  packages/server/src` → the gateway write (`pi-gateway.ts:835`) and the
  diagnostics routes only; `sessionManager.onChange` (`server.ts`) persists
  `.meta.json` and broadcasts nothing.

## 1. Server-derived verdict

Test home: `packages/server/src/session/__tests__/host-pressure-tracker.test.ts`.

- [x] 1.1 Test (red): a fresh frame emits nothing (healthy costs zero frames)
  (test-plan #E1).
- [x] 1.2 Test (red): crossing 35 s emits `degraded` ONCE, stamped with the last
  frame time; crossing 60 s escalates to `unresponsive` ONCE
  (test-plan #E2; test-plan #E3).
- [x] 1.3 Test (red): a frame after a verdict emits an explicit `null`, and the
  next frame does not repeat the clear.
- [x] 1.4 Test (red): `clear()` drops a session silently; sessions are tracked
  independently; `stop()` cancels every pending timer.
- [x] 1.5 Implement `packages/server/src/session/host-pressure-tracker.ts`
  (`createHostPressureTracker`, `HOST_PRESSURE_DEGRADED_MS`,
  `HOST_PRESSURE_UNRESPONSIVE_MS`).
- [x] 1.6 Row added to `packages/server/src/session/AGENTS.md`.

## 2. Gateway wiring

Test home: `packages/server/src/__tests__/pi-gateway-host-pressure.test.ts`.

- [x] 2.1 Test (red, real UDS bridge): a registered bridge that goes quiet raises
  `degraded` then `unresponsive`; a subsequent `session_heartbeat` clears it
  (test-plan #X6).
- [x] 2.2 Feed the tracker from `ws.on("message")` (any frame proves the loop
  runs) and `handleRegister`; clear on `session_unregister` and
  finalize-on-close; `stop()` cancels it.
- [x] 2.3 Add `PiGatewayOptions.onHostPressure` plus the
  `hostPressureDegradedMs`/`hostPressureUnresponsiveMs` test seams.
- [x] 2.4 `server.ts`: turn each transition into `sessionManager.update({
  hostPressure })` + `broadcastToAll(session_updated)`, skipping ended/unknown
  sessions.
- [x] 2.5 Rows added to `packages/server/src/pi/pi-gateway.ts.AGENTS.md`.

## 3. Shared type

- [x] 3.1 `DashboardSession.hostPressure?: {state; since} | null` — `undefined`
  unknown, explicit `null` recovered. Transient: absent from `sessionToMeta`.
- [x] 3.2 Row added to `packages/shared/src/types.ts.AGENTS.md`.

## 4. Client renders the verdict

Test home:
`packages/client/src/components/session/__tests__/SessionCard.host-pressure.test.tsx`.

- [x] 4.1 Test (red, regression): an hour-old `processMetrics.updatedAt` with no
  `hostPressure` renders NOTHING (the exact failure that was on screen).
- [x] 4.2 Test: `undefined` → unknown, `null` → healthy, verdict → pill.
- [x] 4.3 Test: the card self-ticks degraded → unresponsive, and never falls
  below the server verdict under browser clock skew (test-plan #F1; test-plan #F2).
- [x] 4.4 `deriveHostPressure` reads `session.hostPressure`; the local ticker is
  armed on the verdict, not on `processMetrics`.
- [x] 4.5 Row updated in
  `packages/client/src/components/session/SessionCard.tsx.AGENTS.md`.

## 5. Verify

- [x] 5.1 `npx tsc --noEmit` clean.
- [x] 5.2 Full `npm test` green (19 host-pressure tests; the only failures are
  pre-existing environment artifacts unrelated to this change).
- [x] 5.3 `biome check` clean on every new file.
- [x] 5.4 Live: `npm run build` + `POST /api/restart`, then all 13 live sessions
  report `hostPressure` absent (no badge) with fresh bridges — the false badge is
  gone and a healthy session emits nothing.

## 6. Doubt-review corrections (transport, lifecycle, drift)

- [ ] 6.1 A shed verdict frame is repaid: add `hostPressure` to the
  status-reconcile payload in `flushStatusDebt`
  (`packages/server/src/pairing/browser-gateway.ts`), rebuilt from
  `sessionManager.get(id)` like `status`/`currentTool`, with the same load-bearing
  `?? null` clearing semantics.
- [ ] 6.2 Test (red first): a saturated socket sheds a `hostPressure: null`
  recovery; the debt flush rebuilds a frame carrying the live row's
  `hostPressure`, so the badge clears without a reconnect · input: socket with
  `bufferedAmount > MAX_WS_BUFFER` · trigger: recovery broadcast then drain ·
  observable: reconciled `session_updated.updates.hostPressure === null`
  (test-plan #X1; see `browser-gateway-dropped-frames.test.ts`).
- [ ] 6.3 An OPEN bridge socket becomes a precondition of the signal: call
  `hostPressure.clear(...)` on the non-finalize `ws.on("close")` path
  (`pi-gateway.ts`), so carrier loss is left to the heartbeat/status machinery.
- [ ] 6.4 Test (red first): a bridge socket closes without `session_unregister`;
  60 s of silence elapse · observable: zero verdicts emitted
  (test-plan #X2; see `pi-gateway-host-pressure.test.ts`).
- [ ] 6.5 Release tracking state on EVERY exit path — the three
  heartbeat-timeout/sleep-retry `unregister` sites and the reload placeholder
  swap in `pi-gateway.ts` currently leak a map entry and its timers.
- [ ] 6.6 Test (red first): each exit path (explicit unregister, heartbeat
  timeout, sleep-retry expiry, reload swap) · trigger: the exit fires ·
  observable: no timer fires past the thresholds and the tracker holds no entry
  (test-plan #X3; see `pi-gateway-host-pressure.test.ts`).
- [ ] 6.7 Clear the row's `hostPressure` when a session transitions to `ended`,
  so a later `sessions_snapshot` cannot serve a stale verdict.
- [ ] 6.8 Test (red first): a session carrying `unresponsive` ends · observable:
  its row's `hostPressure` is absent in the next snapshot
  (test-plan #X4; see `host-pressure-tracker.test.ts` for the fake-clock setup).
- [ ] 6.9 Move `HOST_PRESSURE_DEGRADED_MS` / `HOST_PRESSURE_UNRESPONSIVE_MS` into
  `packages/shared`; tracker and `SessionCard` both import them (the client's
  between-transition escalation depends on the same numbers the server fires on).
- [ ] 6.10 Test: both consumers read the shared constants and no second
  `35_000`/`60_000` literal survives in either module
  (test-plan #E6; plain unit assertion, no harness).

## 7. Remaining folded scenarios

- [ ] 7.1 Boundary: a frame at `t0+34_999` re-arms the timers — 0 emits at
  `t0+35_000`, degraded lands at `t0+69_999` instead
  (test-plan #E4; see `host-pressure-tracker.test.ts`).
- [ ] 7.2 Decision table: the full 8 cells of `hostPressure ∈ {undefined, null,
  degraded, unresponsive}` × `processMetrics.updatedAt ∈ {now, now-1h}` · trigger:
  card renders · observable: nothing for `undefined`/`null` in BOTH metric ages,
  pill only for the two verdict cells. Also rename the existing
  `"F1: no server verdict yields UNKNOWN, never healthy"` case — the delta now
  says silence renders nothing (test-plan #E5; see
  `SessionCard.host-pressure.test.tsx`).
- [ ] 7.3 Cost promise: a bridge framing every 5 s for 4× the degraded threshold
  · observable: `onHostPressure` invoked 0 times
  (test-plan #P1; see `pi-gateway-host-pressure.test.ts`).
- [ ] 7.4 Transience: a row carrying a verdict round-trips through `sessionToMeta`
  · observable: `hostPressure` absent on the rehydrated row
  (test-plan #X5; see the session-manager meta tests).
- [ ] 7.5 E2E: a live session's bridge stops framing past the threshold, then
  frames again · observable: the card acquires the pressure pill then loses it,
  no page reload · read the port from `.pi-test-harness.json#dashboardPort`
  (test-plan #F3; see `tests/e2e/bridge-contention-health.spec.ts`).
- [ ] 7.6 E2E: a SECOND browser context opens while a session is pressured ·
  observable: both contexts show the identical badge state from
  `sessions_snapshot` (test-plan #F4; see
  `tests/e2e/bridge-contention-health.spec.ts`).
- [ ] 7.7 Badge legibility across studio / earth / athlete / gradient reads as a
  warning, not decoration (test-plan: manual-only).

## 8. Archive housekeeping

- [ ] 8.1 The delta renames the scenario `No metrics yields an absent state, not
  a healthy one` → `Silence from the server renders nothing`. The heading was
  PRE-RENAMED in `openspec/specs/session-host-pressure-indicator/spec.md` at
  planning time so `openspec validate`/`archive` accept the MODIFIED block —
  record that in the archive commit message.
- [ ] 8.2 After `openspec archive --sync`, sweep the synced spec for surviving
  stale text the sync cannot reach (`## Purpose` preamble and any bullets above
  `## Requirements`): `grep -n "already carried\|updatedAt" openspec/specs/session-host-pressure-indicator/spec.md`.
