# Test Plan — serialize-bridge-message-pump

Stage: design   Generated: 2026-08-13

Clarifications C1–C3 were resolved at the HARD gate before this file was written:
- **C1** → one L1 timed burst scenario (P1); budget proposed below, confirm before apply.
- **C2** → L1 only. The ordering guarantee is a property of the pump; an L3 browser
  reproduction of a timing race would be flake-prone for no added proof.
- **C3** → counters asserted via `ConnectionManager` getters; the `ProcessMetrics`
  wiring (task 1.7) is not asserted at L1.

Exemplar for every row below: `packages/extension/src/__tests__/connection.test.ts`
(fake socket + fake timers harness). Sibling exemplars for counter/lifecycle glue:
`connection-dropped-frames.test.ts`, `connection-suppress-auto-start.test.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 ordering | state-transition | L1 | automated | handler that `await`s a deferred promise on `set_model`, resolving after `send_prompt` arrives | `ws.onmessage(set_model)` then `ws.onmessage(send_prompt)` in the same tick | `send_prompt` handler is not entered until the `set_model` handler has returned; recorded call order is exactly `[set_model, send_prompt]` |
| E2 | R1 ordering | state-transition | L1 | automated | 20 interleaved serialized-lane messages, each handler yielding once | delivered back-to-back on one socket | handler completion order === delivery order; 20 dispatched, 0 dropped |
| E3 | R1 cancellation not reordered | sequence | L1 | automated | slow `send_prompt` handler (deferred), then `abort` | both delivered before the first resolves | `abort` handler is entered only after the `send_prompt` handler returns; never before |
| E4 | R2 immediate lane | decision-table | L1 | automated | serialized handler parked on an unresolved promise | `prompt_response` arrives | its handler is invoked before the parked handler resolves |
| E5 | R2 immediate lane | decision-table | L1 | automated | serialized handler parked on an unresolved promise | `server_restarting` with `quiesceMs` arrives | `pauseAutoStart(quiesceMs)` has been applied before the parked handler resolves |
| E6 | R2 immediate lane | decision-table | L1 | automated | serialized handler parked on an unresolved promise | `kill_process` with a pgid arrives | its handler is invoked before the parked handler resolves |
| E7 | R2 default routing | decision-table | L1 | automated | serialized handler parked on an unresolved promise | a message with an unrecognized `type` arrives | it is NOT dispatched until the parked handler resolves (defaults to serialized) |
| E8 | R2 lane membership (negative) | decision-table | L1 | automated | serialized handler parked on an unresolved promise | `abort`, then `shutdown`, then `flow_control` arrive | none is dispatched until the parked handler resolves — the immediate lane is exactly the 3 named types |
| E9 | R4 bound | BVA | L1 | automated | `maxInboundQueue = 4`, one parked handler occupying the loop | enqueue 4 messages (at cap), then a 5th (cap+1) | messages 1–4 accepted and later dispatched in order; the 5th is refused; overflow count === 1 |
| E10 | R4 drop-newest preserves prefix | BVA | L1 | automated | `maxInboundQueue = 4`, queue full, parked handler | a 5th message arrives, then the parked handler resolves | the 4 accepted messages dispatch in original wire order; the 5th never dispatches |
| E11 | R6 replaced session | state-transition | L1 | automated | message carrying `sessionId = "A"` queued behind a parked handler | bridge session identity switches to `"B"` before the queued message is dispatched | the queued message is discarded, not applied to session `B` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R1 (hot-path overhead) | timed burst | L1 | automated | 1000 messages, synchronous no-op handler, single connection | total wall-clock to drain **< 250 ms** (guards against an accidental O(n²) queue implementation; a microtask hop per message should land far below this) | single run |

> **P1 threshold is a proposal, per C1.** 250 ms is deliberately loose — it is a
> shape guard (linear vs quadratic), not a latency SLA. Confirm or replace the
> number before the apply step authors this test.

### Frontend-quirk

None. Per C2 this change is verified entirely at the pump level (L1); no rendered-UI
or WS-driven view assertion is in scope.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R3 failure isolation | fault-injection (reject) | L1 | automated | handler returns a rejected promise for message 1 | messages 1 and 2 delivered back-to-back | the rejection is caught and logged; message 2 is still dispatched, in order; the loop is still alive for message 3 |
| X2 | R3 failure isolation | fault-injection (throw) | L1 | automated | handler throws synchronously for message 1 | messages 1 and 2 delivered back-to-back | same as X1 — caught, logged, message 2 dispatched |
| X3 | R5 discard on disconnect | state-transition | L1 | automated | 3 messages queued behind a parked handler | socket disconnects, then reconnects and delivers a new message | the 3 queued messages are never dispatched; the new message IS dispatched; disconnect-discard count === 3 |
| X4 | R5 in-flight does not block the replacement | fault-injection (abort mid-handler) | L1 | automated | handler parked on an unresolved promise | socket disconnects while parked, bridge reconnects, a message arrives on the new socket | the new message dispatches **without waiting** for the parked handler; when the parked handler finally resolves it dispatches nothing further; exactly one drain loop is active |
| X5 | R5 deliberate teardown | state-transition | L1 | automated | messages queued behind a parked handler | `disconnect()` called directly (reload/teardown path, not `handleDisconnect`) | queue cleared and counted identically to X3 |
| X6 | R4 counter separation | decision-table | L1 | automated | one overflow refusal and one disconnect discard in the same session | both conditions provoked in sequence | overflow count === 1 and disconnect-discard count === 1; neither counter absorbs the other's event |
| X7 | R4 warn rate-limit | BVA (time) | L1 | automated | fake timers; repeated overflow refusals inside one 5 s window, then one after it | provoke refusals at t=0, t=1 s, t=6 s | exactly 2 warnings logged (t=0 and t=6 s); the counter still increments on all 3 |

---

## Coverage summary

- Requirements covered: 6/6 (R1 → E1,E2,E3,P1 · R2 → E4–E8 · R3 → X1,X2 · R4 → E9,E10,X6,X7 · R5 → X3,X4,X5 · R6 → E11)
- Scenarios by class: edge 11 · perf 1 · frontend 0 · error 7
- Scenarios by level: L1 19 · L2 0 · L3 0
- Scenarios by disposition: automated 19 · manual-only 0

## New infra needed

None. `packages/extension/src/__tests__/connection.test.ts` already provides the
fake-socket + fake-timer harness every row needs.
