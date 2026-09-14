# Tasks — fix-backpressure-status-and-subagent-frames

Test tasks are folded from `test-plan.md` (the manifest). Manifest ids in
parentheses map each task back to its scenario row.

## 1. Debt capture (server)

- [x] 1.1 Thread a `dirtyId` argument from `broadcast()` into `fanout()` in `packages/server/src/pairing/browser-gateway.ts`; derive it as `msg.type === "session_updated" ? msg.sessionId : undefined`; every other `fanout` caller (incl. `broadcastOpenSpecUpdateImpl`) passes `undefined`
- [x] 1.2 Add a per-socket `Set<string>` debt register; on a shed frame carrying a `dirtyId`, record the id and increment a reconcile-queued counter
- [x] 1.3 Write the L1 test that only `session_updated` enters the debt set while `sessions_reordered` / `session_added` / `session_removed` / `file_changed` do not — input: saturated fake socket · trigger: broadcast of each type, each shed · observable: debt set holds exactly the one id, reconcile-queued increments exactly once (test-plan #E2; see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`)
- [x] 1.4 Write the L1 test that the debt set is id-only and deduped — input: 100 ids shed 10× each on a saturated socket · trigger: all sheds recorded · observable: set size 100, no serialized payload retained, `stalledSocketsTerminated` 0 (test-plan #E3; see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`)
- [x] 1.5 Write the L1 boundary test that `bufferedAmount` exactly equal to `MAX_WS_BUFFER` is not shed and records no debt — input: socket at exactly 4 194 304 · trigger: broadcast a `session_updated` · observable: frame sent, debt set empty (test-plan #E4; see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`)
- [x] 1.6 Write the L1 test that a shed status frame increments BOTH the drop counter and the reconcile-queued counter — input: saturated socket · trigger: one `session_updated` shed · observable: `droppedFrames.serverToBrowser.total` and reconcile-queued both increment (test-plan #E8; see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`)

## 2. Reconcile flush (server)

- [x] 2.1 Add the debt-set timer lifecycle: start when the set becomes non-empty, stop when it empties; independent of the pending-state interval
- [x] 2.2 On tick, while the socket is under threshold, rebuild a `session_updated` from `sessionManager.get(id)` and send it with `ctx.sessionId` set; remove the id; increment a reconcile-sent counter
- [x] 2.3 Release the debt set and its timer on socket close, on socket error, and on the `sendState` stalled-socket `ws.terminate()` path
- [x] 2.4 Write the L1 test that a shed status frame is redelivered from CURRENT state after drain — input: saturated socket, session `s1` at `streaming`/`Agent` · trigger: shed then drain, reconcile tick · observable: one `session_updated` carrying current `status` + `currentTool`, not the shed payload, within 1 s (test-plan #E1; see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`)
- [x] 2.5 Write the L1 test for settled-value semantics — input: `idle`→`streaming`→`idle` all shed · trigger: drain + reconcile · observable: exactly one delivered frame carrying `idle`, no synthesized `streaming` (test-plan #E5; see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`)
- [x] 2.6 Write the L1 test that a shed reconcile is retried and bounded — input: socket re-crosses the threshold between check and send · trigger: next tick under threshold · observable: id still owed, later reconcile delivers it, debt set size stays 1 (test-plan #X1; see `packages/server/src/__tests__/browser-gateway-critical-frames.test.ts`)
- [x] 2.7 Write the L1 teardown test for socket close — input: non-empty debt set + active timer · trigger: `close` · observable: set removed, interval cleared, no callback after advancing 10 intervals with fake timers (test-plan #X2; see `packages/server/src/__tests__/browser-gateway-shutdown-reject.test.ts`)
- [x] 2.8 Write the L1 teardown test for socket error and for the stalled-terminate path — input: same as 2.7, two variants · trigger: `error` event; byte-ceiling `ws.terminate()` · observable: set + timer released in both, `stalledSocketsTerminated` still increments on the terminate variant (test-plan #X3; see `packages/server/src/__tests__/browser-gateway-critical-frames.test.ts`)
- [x] 2.9 Write the L1 test for a session deleted before its reconcile — input: debt for `s1`, `s1` removed from the session manager · trigger: reconcile tick · observable: no frame, no throw, debt discarded, reconcile-sent not incremented (test-plan #X4; see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`)
- [x] 2.10 Write the L1 test that the reconcile does not depend on the pending-state timer — input: socket shedding only transcript `event` frames · trigger: 10 intervals elapse · observable: no reconcile timer ever started, no frames sent (test-plan #X5; see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`)

## 3. Health surface

- [x] 3.1 Sample per-browser-socket `bufferedAmount`; expose `max`, `p95`, and cumulative ms above threshold on `/api/health`
- [x] 3.2 Expose the reconcile queued + sent counters on `/api/health`
- [x] 3.3 Write the L1 test that all new health fields are present and numeric on a freshly booted gateway with zero sheds — input: fresh gateway · trigger: health read · observable: reconcile counters `0`, occupancy `max`/`p95`/msAboveThreshold numeric (test-plan #E7; see `packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts`)

## 4. Client no-op guarantee

- [x] 4.1 Write the L1 test that a reconcile for an unknown session never creates a row — input: store with no row for `s9` · trigger: `session_updated` for `s9` · observable: store still holds no row (test-plan #E6; see `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`)

## 5. Performance

- [x] 5.1 Write the L1 timed test that a 100-debt reconcile flush costs < 1 ms wall (median of 20 runs) — input: 100 ids, populated session manager, socket under threshold · trigger: one flush · observable: wall time < 1 ms (test-plan #P1; see `packages/server/src/__tests__/browser-gateway-load.test.ts`)
- [x] 5.2 Write the L1 timed test that debt capture adds < 5 % to the shed path — input: 10 000 broadcasts of non-`session_updated` types onto a saturated socket · trigger: all shed · observable: added wall time vs. baseline < 5 % (test-plan #P2; see `packages/server/src/__tests__/browser-gateway-broadcast-serialize-once.test.ts`)

## 6. End-to-end

- [x] 6.1 Write the L3 spec that a stale card heals without a reload — input: dashboard on the harness port from `.pi-test-harness.json` (`dashboardPort`), session driven to `streaming` while its socket is saturated · trigger: saturation released · observable: card converges to the working indicator within 1 s, no reload (test-plan #F1; landed in `tests/e2e/status-reconcile.spec.ts`)
- [x] 6.2 Write the L3 spec that an `ended` transition converges exactly once — input: same harness, session ends while saturated · trigger: saturation released · observable: card converges to `ended` once, no incorrect status rendered after the reconcile (test-plan #F2; landed in `tests/e2e/status-reconcile.spec.ts`)

## 7. Docs

- [x] 7.1 Delegate to DocScribe: record the reconcile contract and the new health fields in `docs/architecture.md`, and update the `browser-gateway.ts` row in `packages/server/src/pairing/AGENTS.md`
