# Design — serialize-bridge-message-pump

## Context

`packages/extension/src/connection.ts` (`ConnectionManager.ws.onmessage`, ~L199)
parses each inbound frame and invokes `this.onMessage?.(parsed)` **without
`await`**. `onMessage` is the async `safe(async (data) => {...})` closure in
`packages/extension/src/bridge.ts` (~L725). Every frame therefore starts an
independent microtask; a handler that yields at its first `await` lets the next
frame's handler run to completion inside that yield.

Proved race (`openspec-dialog-model-effort-selector` spike): `set_model` →
`await options.setModel(...)` (`command-handler.ts:788`) yields; the following
`send_prompt` forwards to pi during that yield and the turn runs on the **old**
model. Silent, produces a plausible-looking run.

### Facts established while designing (verified against source)

| fact | evidence |
|---|---|
| The slowest main-lane handler is bounded at 30 s | `send_prompt` `!bash` → `handleBashCommand` → `await pi.exec(..., { timeout: BASH_TIMEOUT })`, `BASH_TIMEOUT = 30_000` (`command-handler.ts:286,1041`) |
| `abort` does **not** cancel a running bash child | `abort` → `options.abort()` → `cachedCtx.abort()` (`bridge.ts:1176`) cancels a **pi turn**; `handleBashCommand` has no abort wiring. Only `kill_process` → `killProcessByPgid` (`command-handler.ts:794`) terminates a child |
| `send_prompt` does **not** await a full agent turn | passthrough path calls `sendUserMessageWithImages` and returns (`command-handler.ts:~632`) |
| No inbound handler awaits `promptBus.request` **today** | every `bus.request` site is a `ctx.ui.*` adapter or the pi-flows bridge (`bridge.ts:2179-2342`), driven from a pi turn, not from the pump |
| `flow_control{action:"abort"}` is a **second** abort route | `bridge.ts:969` — emits `flow:abort` / `flow:architect-abort` synchronously |
| `onMessage` is typed `(data: unknown) => void` | `connection.ts:12,26` — must widen to return `void \| Promise<void>` to be awaitable |

## Goals / Non-Goals

**Goals**
- A state-mutating message runs to completion before a dependent message is
  dispatched (`set_model` → `send_prompt`).
- A throwing/rejecting handler is isolated and the pump continues in order.
- The inbound queue has an explicit bound, distinct from the outgoing
  `maxBufferSize` ring (`connection.ts:110`).
- No permanent hang; no silent loss of a cancellation.

**Non-Goals**
- Removing the client-side confirm-before-send gate in
  `openspec-dialog-model-effort-selector` (kept as belt-and-suspenders).
- Reordering or coalescing messages. Server→bridge wire protocol is unchanged.
- Per-session queues. Note the manager is **not** strictly one-session: `sessionId`
  is a closure variable mutated in place on `new`/`fork`/`resume`
  (declared `bridge.ts:190`, reassigned at `bridge.ts:1366` and `bridge.ts:2027`)
  and `commandHandler.handle` evaluates its sessionId guard
  at **dispatch** time (`command-handler.ts:428-432`). Serializing moves that
  evaluation from arrival time to dispatch time, so a message queued before a
  session switch is silently discarded by the guard after it. That is accepted
  (the message was addressed to a session that no longer exists) but it IS a
  behaviour delta and is covered by a scenario.
- Making `abort` cancel an in-flight bash child. That is a real gap
  (`handleBashCommand` has no abort wiring) but it exists today and is **not**
  created by this change. Filed as a follow-up, not fixed here.

## Decision 1 — Serialize inside `ConnectionManager`, not in `bridge.ts`

**Chosen:** own the queue in `ConnectionManager`; `ws.onmessage` enqueues, a
single drain loop `await`s `this.onMessage?.(parsed)` per message.

- (a) `ConnectionManager` — **chosen.** `ConnectionManager` *is* the pump the
  spec names; the ordering guarantee then holds for every consumer, not just
  today's single caller. Unit-testable without booting the bridge (inject a
  fake socket + a handler that yields).
- (b) wrap the closure in `bridge.ts` — rejected. Leaves the trap open for any
  future `ConnectionManager` consumer and forces the tests through bridge boot.

**Type impact:** `ConnectionManagerOptions.onMessage` widens from
`(data: unknown) => void` to `(data: unknown) => void | Promise<void>`
(`connection.ts:12,26`). Non-breaking for the existing caller.

## Decision 2 — Serialize everything except the reply lane

**Chosen:** an immediate lane of exactly three types — `prompt_response`,
`server_restarting`, `kill_process`. Every other inbound type, **including
`abort`, `shutdown` and `flow_control`**, goes through the serialized queue in
wire order. An unknown/new type defaults to the serialized lane.

Each immediate-lane type earns its place by being **incapable of arriving
"before its target"** — none of them invalidates a message queued behind it:

| type | why immediate |
|---|---|
| `prompt_response` | a reply correlated by **request id** (`bridge.ts:916` → `promptBus.respond()`), synchronous, early-returning. If a handler ever awaits `promptBus.request(...)`, queueing its reply behind that handler is a **permanent** deadlock, not a latency cost |
| `server_restarting` | a **time-critical lifecycle signal**: the server broadcasts it immediately before exiting, and the socket closes right after. It only calls `connection.pauseAutoStart(quiesceMs)` (`bridge.ts:747-760`). Queued → it is discarded by Decision 5's disconnect-clear, `shouldSuppressAutoStart()` never fires, and the duplicate-server spawn race that `fix-restart-bridge-auto-start-race` closed **reopens** |
| `kill_process` | keyed to a concrete **pgid** of an already-running child (`command-handler.ts:794`, `killProcessByPgid`). It cannot pre-empt a message it was meant to follow — an unknown pgid is a no-op. It is also the **only** working way to terminate a long `!bash` child, so serializing it behind that exact child defeats the mechanism entirely |

Why cancellation (`abort`) is **not** bypassed (reversal of the first draft):

- Bypassing `abort` **loses cancellations**. Wire order `[send_prompt, abort]`
  with a non-empty queue → `abort` runs first against nothing (no-op), then
  `send_prompt` starts the turn the user just cancelled. That is a new silent
  bug, and it violates the wire-order requirement directly.
- The bypass wouldn't buy what it claimed. In the fast case `send_prompt`
  forwards to pi and returns in ~ms, so a serialized `abort` waits ~nothing. In
  the slow case (`!bash`) `abort` **cannot** stop `pi.exec` anyway — so
  bypassing it does not restore liveness. Both extremes fail.
- The residual cost is bounded and explicit: while a `!bash` handler occupies
  the queue, `abort` / `kill_process` / `flow_control` wait **at most 30 s**
  (`BASH_TIMEOUT`). Accepted trade-off, recorded here rather than hidden.

`shutdown` and `flow_control` stay serialized: both are cheap and
order-dependent (a `shutdown` ahead of a queued `send_prompt` would tear down
before the work it was meant to follow).

Rejected alternatives: full serialization with **no** immediate lane (reopens
the restart race, defeats `kill_process`, and leaves the permanent-deadlock
class open); the original five-type control lane (adds `abort` + `shutdown` and
with them the cancel-before-target loss above); a priority queue (still
deadlocks when the head-of-line handler is the one awaiting the reply).

## Decision 3 — Inbound bound: cap + drop-newest with a warn log

**Chosen:** explicit `maxInboundQueue` (default `1000`), a separate field from
`maxBufferSize`. On overflow the **newest** message is dropped, a rate-limited
`console.warn` is emitted (mirroring the existing `DROP_WARN_WINDOW_MS` pattern
at `connection.ts:100`), and `getDroppedInboundCount()` exposes the count.

- **drop-newest (chosen)** — never invalidates an already-accepted ordering
  prefix. Everything already queued keeps its guarantee; only the tail is
  refused.
- drop-oldest — rejected. The outgoing ring drops oldest because losing a stale
  *event* is acceptable; dropping the oldest *command* silently discards the
  `set_model` whose ordering is the entire point of this change.
- reject-with-error-to-sender — rejected for this change: the server→bridge
  protocol has no inbound-nack message; adding one is out of scope.

**Two distinct counters, not one.** Overflow refusals and disconnect-clears must
be counted separately. Disconnect-clears are **routine** (every server restart
drains a pending inbound queue), so folding both into one number would let
reconnect churn mask the overflow signal the warn exists to raise.

**Overflow weakens the ordering guarantee, and the spec says so explicitly.**
Dropping the newest can drop a `send_prompt` that followed a `set_model`. The
ordering requirement is therefore scoped to *accepted* messages, and the
back-pressure requirement carries the carve-out. Without that reconciliation the
spec asserts both "none dropped" and "apply a drop policy".

`1000` is arbitrary-but-safe: the queue only grows while a handler is awaiting,
and every realistic burst (state sync, replay) is orders of magnitude smaller.
Overflow is a bug signal (hence the warn), not a routine path.

## Decision 4 — Failure isolation lives in the drain loop

The drain loop wraps each `await this.onMessage?.(...)` in try/catch and logs.
This is **not** redundant defensive coding: the spec puts the
"a failed handler does not stall the queue" guarantee on the *pump*, and the
pump is where the loop that could stall lives. `safe()` (`bridge.ts:692`)
independently catches on the bridge side; that stays as-is and is not the
mechanism this requirement is tested against.

## Decision 5 — Pending inbound is dropped on disconnect

**Chosen:** the queue is cleared whenever the socket goes away, and the drain
loop is bound to a monotonically increasing **epoch**. Teardown
(`handleDisconnect()` or the deliberate `disconnect()`, `connection.ts:121-145`)
clears the queue, bumps the epoch, and **releases the running-guard
immediately** — it does NOT wait for the in-flight handler.

The release point is the load-bearing detail. An in-flight handler cannot be
cancelled, so if the guard were released only when the old loop finally exits,
`createConnection()` could not start a fresh loop until that handler resolved —
stalling the *new* connection for the full handler duration and violating the
"disconnect during an in-flight handler does not deadlock the pump" scenario.
Instead:

- teardown bumps the epoch + releases the guard → the new connection's loop starts
  right away;
- the old (zombie) loop finishes its in-flight handler, compares its captured
  epoch to the current one, sees a mismatch, and **self-exits without touching
  the queue or the guard** — so it can never dispatch a stale message or steal
  the new loop's slot.

A bare boolean guard cannot express this: it conflates "a loop is running" with
"this loop owns the queue". The epoch separates them.

Loop start is gated on successful socket construction — the WS-constructor-fail
branch never starts a loop, so there is nothing to tear down there.

- Commands queued against a socket that died are stale: the server has already
  lost the response path, and the reconnect handshake resyncs state
  (`request_state_sync` / `replaySessionEntries`).
- Draining across a reconnect would head-of-line-block connection #2's messages
  behind connection #1's backlog — the exact stall this change exists to avoid,
  moved one level up.
- Drop is counted into `getDroppedInboundCount()` so it is observable rather
  than silent.

The drain loop is **per-connection**, started from `createConnection()`, with a
guard so a reconnect cannot start a second concurrent loop.

## Risks

| risk | mitigation |
|---|---|
| **A hung handler now stalls the whole pump, not just its own task** | this is the change's central cost. Today an unresolved handler leaks one task; serialized, it head-of-line-blocks every subsequent serialized message for the whole connection. The immediate lane keeps `kill_process` and `server_restarting` reachable, and the epoch clear recovers the pump on reconnect — but there is **no within-connection mitigation**, by design (a per-handler timeout would be speculative and would change handler semantics) |
| The "30 s per handler" bound is not universal | `!bash` is capped by `BASH_TIMEOUT`, but `git_commit_draft`'s 30 s `Promise.race` wraps only `session.prompt` (`commit-draft-agent.ts:92-95`) — the preceding `await import(...)` / `createAgentSession` (L67-74) and `buildDiff`'s per-file `git diff` are **unbounded**; `list_sessions` and `request_models` are FS/network-bound with no cap. Treated as known-unbounded, surfaced by the overflow counter rather than papered over with a speculative timeout |
| `abort` / `shutdown` / `flow_control` wait behind a slow handler | bounded per handler where a bound exists, but **cumulative** — N queued slow handlers = N × their bound. The client emits at most one such command at a time in practice |
| **Overflow can refuse an `abort`** | drop-newest deletes the newest message, and a cancellation is typically the newest. Decision 2 preserves cancellations against *reordering*; it cannot preserve them against *refusal*. Accepted: reaching a 1000-deep inbound queue is already a pathological state, and the split overflow counter makes it visible. Not silently ignored — recorded here as the one cancellation-loss path that survives |
| The immediate lane is the wrong set | each member is justified by being pgid-/id-keyed or a lifecycle signal (Decision 2 table); everything else defaults to serialized (allow-list direction is safe); L1 tests assert each dispatches while the main lane is blocked |
| Overflow drops a dependent message and re-opens the race | warn + counter make it observable; the overflow counter is kept **separate** from the routine disconnect-clear counter (Decision 3) so a real overflow is not buried under reconnect churn; spec scopes ordering to accepted messages |
| Slow main-lane handlers are more common than assumed | `send_prompt` passthrough returns without awaiting the turn, but `git_commit_draft` (`command-handler.ts:704`) DOES await a fork-subagent turn and `!bash` awaits `pi.exec` then `sendUserMessage`. These are the known slow set; counters surface any other |
| A second concurrent drain loop, or a permanently dead pump, after reconnect | epoch-bound loop + running-guard (Decision 5); covered by an L1 reconnect test including the disconnect-while-handler-in-flight case |
| Existing tests assert handler side-effects synchronously after `onmessage` | dispatch becomes microtask-async; task 1.8 sweeps `connection.test.ts` and any bridge test that depends on synchronous dispatch |

## Open Questions

None blocking. `maxInboundQueue` is tunable via `ConnectionManagerOptions` if a
real workload ever approaches it.

## Reply types deliberately NOT in the immediate lane

`architect_prompt_response` and `extension_ui_response` are dead no-ops today:
both are routed through `prompt_response` → `promptBus.respond()`
(`bridge.ts:750`, `bridge.ts:928`) and fall into `command-handler.ts`'s
`default: return undefined`. They are intentionally omitted — adding them would
be dead code.

## Follow-ups (not this change)

- `abort` does not cancel an in-flight `handleBashCommand` child process
  (pre-existing; `kill_process` is the only working path).
