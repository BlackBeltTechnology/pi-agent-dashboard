## 1. Serialize the message pump

- [ ] 1.1 In `packages/extension/src/connection.ts`, add an inbound queue + single drain loop that `await`s `this.onMessage?.(parsed)` per message, so each handler runs to completion before the next accepted message is dispatched (design Decision 1). Widen `ConnectionManagerOptions.onMessage` to `(data: unknown) => void | Promise<void>` (`connection.ts:12,26`).
- [ ] 1.2 Route `prompt_response`, `server_restarting` and `kill_process` to the immediate lane; every other type, including `abort` / `shutdown` / `flow_control`, is serialized, and an unrecognized type defaults to the serialized lane (design Decision 2).
- [ ] 1.3 Add `maxInboundQueue` to `ConnectionManagerOptions` (default 1000) as a field SEPARATE from the outgoing `maxBufferSize` ring. On overflow refuse the NEWEST message, emit a rate-limited `console.warn` reusing the `DROP_WARN_WINDOW_MS` pattern (`connection.ts:100`), and expose an overflow-refusal count SEPARATE from the disconnect-discard count of task 1.5 (design Decision 3).
- [ ] 1.4 Wrap each drain-loop `await` in try/catch + log so a rejecting handler cannot stall the pump (design Decision 4).
- [ ] 1.5 Bind the drain loop to a monotonic epoch. On BOTH teardown paths — `handleDisconnect()` and the deliberate `disconnect()` (`connection.ts:121-145`) — clear the pending inbound queue, count the discard into a disconnect-discard counter, bump the epoch, and RELEASE the running-guard immediately (do NOT wait for the in-flight handler). The superseded loop finishes its in-flight handler, sees the epoch mismatch, and self-exits without touching the queue or the guard. Gate loop start on successful socket construction (design Decision 5).
- [ ] 1.6 Replace the now-false concurrency comment at `connection.ts:201-209` ("Handler dispatch is intentionally concurrent … tracked as a follow-up") with the serialized-pump semantics + `See change: serialize-bridge-message-pump`.
- [ ] 1.7 Surface the overflow-refusal count through the same diagnostics channel that already carries `ProcessMetrics.droppedBufferedFrames` (`packages/shared/src/protocol.ts:128-147`), so a refusal suppressed by the 5 s log rate-limit is still observable.
- [ ] 1.8 Sweep every test that constructs a `ConnectionManager` and assumes synchronous dispatch after `ws.onmessage`; dispatch is now microtask-async. Named files: `connection.test.ts`, `watchdog.test.ts`, `connection-dropped-frames.test.ts`, `connection-suppress-auto-start.test.ts` (exercises `server_restarting` → `pauseAutoStart`, whose timing changes with the immediate lane), and `bridge-resume-disconnect.test.ts` (the #393 reconnect regression — directly in the blast radius of the epoch change).

## 2. Tests

All rows below are L1 vitest in `packages/extension/src/__tests__/`. Harness exemplar
for every task: `packages/extension/src/__tests__/connection.test.ts` (fake socket +
fake timers); counter/lifecycle glue exemplars: `connection-dropped-frames.test.ts`,
`connection-suppress-auto-start.test.ts`.

- [ ] 2.1 Ordering — `set_model` then `send_prompt`: handler that awaits a deferred promise on `set_model`, resolving after `send_prompt` arrives · both delivered in the same tick · `send_prompt` is not entered until `set_model` returns, recorded order is exactly `[set_model, send_prompt]`. See `connection.test.ts` (test-plan #E1).
- [ ] 2.2 Ordering — burst: 20 interleaved serialized-lane messages, each handler yielding once · delivered back-to-back on one socket · completion order === delivery order, 20 dispatched and 0 dropped. See `connection.test.ts` (test-plan #E2).
- [ ] 2.3 Cancellation not reordered: slow deferred `send_prompt` handler then `abort` · both delivered before the first resolves · `abort` is entered only after the `send_prompt` handler returns, never before. See `connection.test.ts` (test-plan #E3).
- [ ] 2.4 Immediate lane — `prompt_response`: serialized handler parked on an unresolved promise · `prompt_response` arrives · its handler is invoked before the parked handler resolves. See `connection.test.ts` (test-plan #E4).
- [ ] 2.5 Immediate lane — `server_restarting`: serialized handler parked · `server_restarting` with `quiesceMs` arrives · `pauseAutoStart(quiesceMs)` applied before the parked handler resolves. See `connection-suppress-auto-start.test.ts` (test-plan #E5).
- [ ] 2.6 Immediate lane — `kill_process`: serialized handler parked · `kill_process` with a pgid arrives · its handler is invoked before the parked handler resolves. See `connection.test.ts` (test-plan #E6).
- [ ] 2.7 Default routing: serialized handler parked · a message with an unrecognized `type` arrives · it is NOT dispatched until the parked handler resolves. See `connection.test.ts` (test-plan #E7).
- [ ] 2.8 Lane membership negative: serialized handler parked · `abort`, `shutdown`, `flow_control` arrive · none dispatches until the parked handler resolves — the immediate lane is exactly the 3 named types. See `connection.test.ts` (test-plan #E8).
- [ ] 2.9 Bound BVA: `maxInboundQueue = 4` with one parked handler · enqueue 4 (at cap) then a 5th (cap+1) · 1–4 accepted and later dispatched in order, the 5th refused, overflow count === 1. See `connection-dropped-frames.test.ts` (test-plan #E9).
- [ ] 2.10 Drop-newest preserves prefix: `maxInboundQueue = 4`, queue full, parked handler · a 5th arrives then the parked handler resolves · the 4 accepted dispatch in original wire order and the 5th never dispatches. See `connection-dropped-frames.test.ts` (test-plan #E10).
- [ ] 2.11 Replaced session: message carrying `sessionId = "A"` queued behind a parked handler · session identity switches to `"B"` before dispatch · the queued message is discarded, not applied to session `B`. See `connection.test.ts` (test-plan #E11).
- [ ] 2.12 Hot-path overhead (timed): 1000 messages with a synchronous no-op handler on a single connection · drained in one burst · total wall-clock < 250 ms (shape guard against an O(n²) queue, NOT a latency SLA — confirm the number before authoring). See `connection.test.ts` (test-plan #P1).
- [ ] 2.13 Failure isolation (reject): handler returns a rejected promise for message 1 · messages 1 and 2 delivered back-to-back · rejection caught and logged, message 2 still dispatched in order, loop still alive for message 3. See `connection.test.ts` (test-plan #X1).
- [ ] 2.14 Failure isolation (throw): handler throws synchronously for message 1 · messages 1 and 2 delivered back-to-back · caught and logged, message 2 dispatched. See `connection.test.ts` (test-plan #X2).
- [ ] 2.15 Discard on disconnect: 3 messages queued behind a parked handler · socket disconnects then reconnects and delivers a new message · the 3 never dispatch, the new one does, disconnect-discard count === 3. See `connection.test.ts` (test-plan #X3).
- [ ] 2.16 In-flight does not block the replacement: handler parked on an unresolved promise · socket disconnects while parked, bridge reconnects, a message arrives on the new socket · the new message dispatches without waiting for the parked handler, the parked handler dispatches nothing further when it resolves, exactly one drain loop is active. See `bridge-resume-disconnect.test.ts` (test-plan #X4).
- [ ] 2.17 Deliberate teardown: messages queued behind a parked handler · `disconnect()` called directly (reload/teardown path, not `handleDisconnect`) · queue cleared and counted identically to 2.15. See `connection.test.ts` (test-plan #X5).
- [ ] 2.18 Counter separation: one overflow refusal and one disconnect discard in the same session · both provoked in sequence · overflow count === 1 and disconnect-discard count === 1, neither absorbs the other's event. See `connection-dropped-frames.test.ts` (test-plan #X6).
- [ ] 2.19 Warn rate-limit: fake timers, refusals provoked at t=0, t=1 s, t=6 s · repeated overflow inside one 5 s window then one after it · exactly 2 warnings logged (t=0, t=6 s) while the counter increments on all 3. See `connection-dropped-frames.test.ts` (test-plan #X7).

## 3. Reconcile

- [ ] 3.1 Confirm the client-side confirm-before-send gate in `openspec-dialog-model-effort-selector` remains correct as belt-and-suspenders (do not remove it in this change).
- [ ] 3.2 Confirm the P1 wall-clock budget in task 2.12 (proposed 250 ms) before that test is authored.
