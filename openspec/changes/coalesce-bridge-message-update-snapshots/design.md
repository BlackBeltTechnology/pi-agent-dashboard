# Design — Coalesce bridge `message_update` text snapshots

## Context

See `proposal.md` — Why. Design-level facts that shape the approach, verified
against `origin/develop`:

- pi's extension event is `MessageUpdateEvent { type, message, assistantMessageEvent }`
  (`pi-coding-agent/dist/core/extensions/types.d.ts:597`). The sub-event union
  (`pi-ai/dist/types.d.ts:410`) is `start | text_start | text_delta | text_end |
  thinking_start | thinking_delta | thinking_end | toolcall_start |
  toolcall_delta | toolcall_end`. Every member carries `partial: AssistantMessage`
  — a **full accumulated snapshot**, not a delta.
- `bridge.ts` forwards every enriched event through ONE handler body
  (`bridge.ts:2136-2559`). `message_update` handling today is a single
  `maybeInlineAssistantImages(event)` call at `bridge.ts:2473`, then the shared
  `mapEventToProtocol` + `connection.send(msg)` tail at `bridge.ts:2531-2552`.
- That handler body has **many early returns** before the tail: custom-message
  guards, the `message_start` deferral branch, the `message_end` branch
  (`return` at the end of its `setTimeout` block), pass-through sends. Any new
  early-returning branch is a latent ordering bug for this change.
- `bridge.ts` already has a monotonic `generation` counter (`bridge.ts:143-249`)
  but it is a **bridge-instance** counter used only for `isActive()` stale-listener
  bail-out. It is NOT a per-message counter and cannot be reused as the barrier.
- pi mutates `event.message.id` in place only at persistence time, AFTER the
  handler returns (`fix-per-message-fork` comment, `bridge.ts:2410-2418`). So
  `message.id` does not exist during streaming.
- The `message` / `partial` object reference is **stable and mutated in place**
  across a message's lifetime — `bridge.ts` keys `pendingNonces` / `idByMessage`
  WeakMaps by that ref from `message_start` through `message_end`, which only
  works because it is not cloned. A parked event is therefore a **live** object
  whose content keeps growing after it is parked (see D2). `mapEventToProtocol`
  does not break the aliasing either: `extractSerializable`
  (`event-forwarder.ts:7-20`) is a **shallow** own-key copy, so `data.message`
  stays the same live reference.
- `AssistantMessage.timestamp` and `UserMessage.timestamp` are **required**
  fields (`pi-ai/dist/types.d.ts:184-201`), set when the partial is created and
  stable for its lifetime — unlike `id`. That is what makes them usable as key
  material (D4).
- `message_end` does not send synchronously: its wire send is deferred in a
  `setTimeout(0)` (`bridge.ts:2455-2467`) so pi's `appendMessage` can stamp
  `message.id` first. `retryTracker.observeMessageEnd` + any synthetic retry
  event DO send synchronously in the same handler.
- The bridge writes to the wire from ~74 `connection.send(...)` sites, not only
  from the two event loops. The chat-content-ordered ones outside the loops are
  the custom-persistence wrapper (`wrapCustomPersistenceForCtx`,
  `bridge.ts:811-880`, synthesized `custom_entry` / custom `message_end`) and
  `sendSyntheticRetryEvent`. See D5.
- `packages/server/src/session/replay-compaction.ts:82-96` keeps **the last
  text-bearing `message_update` preceding each `tool_execution_start`** — it
  seeds the reducer's `flush-<toolCallId>` row. See D9.
- `subagent-tick-throttle.ts` is the existing precedent for a bridge-side
  throttle: `offer()` returns false when it takes ownership of a frame, plus
  `onTerminal()` to discard. It throttles subagent tool frames only and is
  untouched here.

## Goals / Non-Goals

**Goals:**

- Cut bridge-side `JSON.stringify` + `ws.send` work during a streaming turn from
  O(tokens) to O(turn duration / 50 ms), with the forwarded payload shape
  unchanged.
- Make the ordering guarantee **structural**, not a convention spread over
  branches — a new early-returning branch must not be able to silently break it.
- Keep thinking/toolcall sub-events lossless and in source order.

**Non-Goals:**

- No change to the wire protocol, the server fold, or the client render batching.
  Those layers cut *render* cost; this one cuts *bridge* cost. The proposal's
  overlap question is settled by measurement (see Decision D0), not by design.
- No coalescing of the subagent tick path (already throttled).
- No adaptive/derived window. A single constant, revisited only if measurement
  says so.

## Decisions

### D0 — Measure the bridge-side cost on `develop` before implementing

The `doubt-driven-review` question ("does upstream's server fold + render
batching already capture the win?") is answered by a **before** measurement, not
argument. The measurement is bridge-local and does not depend on the consumer
layers: count `message_update` sends and total bytes stringified for one long
assistant turn, on `develop`, with a counter patch or the existing
`subagentTickThrottle.stats` pattern. Re-measure after. Task 1 is this
measurement, and it gates the rest: if the send count for a real turn is not
materially above `duration / 50 ms`, the change is not worth its ordering risk
and we stop and report.

*Alternative rejected:* implement first, measure after. That is how a win gets
double-counted against the server-fold change.

### D1 — A separate transport-agnostic module, not inline bridge state

`packages/extension/src/message-update-coalescer.ts` owns the state machine.
`bridge.ts` supplies `send`, the timer schedule/cancel, and the clock via
constructor injection.

*Why:* the ordering semantics are timing-dependent and can only be proven with
fake timers. `bridge.ts` is ~3.7 kLOC of session/WS/pi wiring and cannot be
instantiated in a unit test; the semantics would then only be testable through
the end-to-end bridge test, which is exactly the surface that already misses
timing bugs. Injected timers also match the existing `subagent-tick-throttle.ts`
shape.

*Alternative rejected:* inline `let pendingUpdate` in `initBridge`. Cheaper to
write, untestable at the semantics level.

### D2 — Single slot, last-wins, **fixed** window (not a debounce)

Only one assistant message streams at a time in pi, so one slot suffices; a map
keyed by message would add state with no reachable second key.

The window is anchored at the arrival of the **first** pending update and is not
restarted by later ones. A debounce would starve: a continuous token stream never
sees a 50 ms gap, so the first snapshot would land only at `message_end` and the
UI would show nothing streaming at all. Fixed window bounds added latency at
exactly one window and keeps it non-cumulative.

`COALESCE_WINDOW_MS = 50` — ~20 frames/s, below the ~100 ms perceptual threshold
for "instant" feedback, and an order of magnitude above the per-token interval
of a fast provider.

**The slot holds the live event; serialisation happens at flush — accepted, with
its consequence stated.** `partial` is the same object mutated in place for the
whole message, and `mapEventToProtocol`'s `extractSerializable` is a shallow
copy, so a held snapshot keeps aliasing pi's growing message no matter when it
is mapped. A flushed snapshot can therefore carry content that arrived *after*
the update it nominally represents.

That is **safe because these snapshots are cumulative**: the extra content is
always a strict superset of the represented update and exactly what the next
snapshot would carry anyway. The client is last-wins over full snapshots, so the
only observable effect is content appearing marginally *early* — never late,
never lost, never re-ordered against a later state. Content can never appear
after its own message closes, because D4 drops closed-key updates.

*Alternative rejected:* deep-clone (or `JSON.stringify`) each snapshot at park
time to get a true point-in-time copy. That pays a full serialisation **per
source token** — precisely the cost D0 measures and this change exists to remove
— to buy a distinction the consumer cannot observe.

*Alternative rejected:* per-`contentIndex` slots. pi streams one text block at a
time and the snapshot is whole-message anyway, so the extra slot buys nothing.

### D3 — Two families: TEXT coalesces, everything else flush-then-forward

`text_start | text_delta | text_end` → pending slot. **Every other sub-event
type, including unrecognised ones** → `flush()` then forward immediately.

Defaulting *unknown* to immediate forwarding (not to coalescing) is the safe
side of the fail-open/fail-closed choice: a future pi sub-event that is additive
rather than snapshot-carrying (the `thinking_delta` failure mode) would be
silently swallowed under the opposite default. The cost of the safe default is
only that a future snapshot-carrying type is not coalesced until we add it.

### D4 — Barrier = (generation, messageKey), both required

- **generation**: a per-message counter local to this feature, incremented on
  EVERY `message_start` (user *and* assistant). User starts matter because a
  retry chain or a new turn must reset the barrier too. This is a NEW counter,
  distinct from the bridge-instance `generation` at `bridge.ts:143`.
- **messageKey**: `` `${gen}:${role}:${timestamp}` `` — the generation is part of
  the key, not a separate check.

The generation is folded INTO the key because a `message_update` carries no
generation of its own: the bridge can only stamp the counter's *current* value,
which would make a standalone gen comparison vacuously true. The counter's job
is to disambiguate `role:timestamp`, which is neither unique nor monotonic —
two messages created in the same millisecond (retry loop, mock provider, coarse
Windows clock) collide on it. `message.id` is unusable (does not exist until
post-handler persistence). Object identity WOULD work (the ref is stable) but is
rejected anyway: the bridge already carries WeakMaps keyed by it, and a string
key keeps the coalescer transport-agnostic and trivially assertable in tests.

The generation is still passed explicitly to the lifecycle calls, where it is
NOT vacuous: a deferred `messageEnd` from an older generation must not close a
newer open message.

API: `messageStart(gen, key)` opens, `messageEnd(gen, key)` closes **after** the
bridge has flushed the final snapshot.

**The drop rule is narrow and fail-open: ONLY an update whose key has already
been closed by `messageEnd` is dropped. Everything else opens or re-opens the
slot.** Two cases motivate the fail-open half:

- *No message open.* `npm run reload` (this change's own ship path) re-inits the
  bridge mid-turn, so the new instance never sees that message's
  `message_start`. Dropping here would silence the rest of the turn.
- *A different, non-closed key.* Any unanticipated interleaving (a message the
  bridge never saw opened) would otherwise be silently swallowed for the rest of
  the turn. Instead the coalescer flushes pending text and re-opens under the new
  key.

The straggler defect this change exists to fix is covered by the closed-key half
alone: message A's pending snapshot cannot land after A's `message_end`, because
A's key is closed the moment the bridge flushes and closes it.

*Verified, so it is not re-litigated:* subagent traffic reaches the bridge as
`tool_execution_update` ticks (`isSubagentTick`, `bridge.ts:2540`), not as
`message_update`, so there is no known second concurrent message stream. The
fail-open rule means a future one costs a lost window's coalescing, not content.

*Alternative rejected:* reuse the bridge-instance `generation`. It only changes
on `initBridge`, so it gives zero intra-session ordering.

### D5 — Flush at handler entry, enforced by a single choke point

The invariant is "no non-`message_update` event may be written to the wire while
a snapshot is pending". Rather than scatter `flush()` across every branch, the
enriched-event handler calls `flush()` **once at the top of the handler body**,
before any branch runs, for every `eventType !== "message_update"`. The
pass-through handler loop does the same. One statement per handler, covering
every early return in that handler — including branches added later.

This is the structural guard the `review-code` discipline note asks for. A test
asserts it directly: drive a pending snapshot, dispatch an event type that takes
an early-return branch, assert the snapshot is already on the wire.

**Sinks outside the two loops.** The bridge sends from ~74 sites; the handler
entry covers only the enriched and pass-through loops. Of the rest, the only
chat-content-ordered sinks are `wrapCustomPersistenceForCtx`
(`bridge.ts:811-880`, synthesized `custom_entry` / custom `message_end`) and
`sendSyntheticRetryEvent` — both can fire mid-turn and both render as chat rows.
They get an explicit `flush()` at their own entry. Every other site (heartbeat,
`models_list`, `flows_list`, `session_name_update`, queue updates, asset
registration) carries no chat-row content and is out of scope for the invariant —
this enumeration IS the contract, and the coalescer's own send must not re-enter
it. `first_message_update` (`bridge.ts:3659`) is deliberately excluded: it is a
once-per-session **metadata** send feeding the session card's label, not a chat
row, so its position relative to a snapshot is unobservable.

**Placement against the deferred branches.** `message_end` flushes at handler
entry (synchronous) and calls `messageEnd(gen, key)` there too — before its own
`setTimeout(0)` send is scheduled. That ordering is what makes the final
snapshot precede the deferred `message_end` on the wire while any straggler that
arrives during the macrotask gap is dropped by the closed slot. `message_start`
likewise bumps the generation and calls `messageStart` at entry, after the flush
and before the `role === "custom"` guard's early return.

*Alternative rejected:* wrap `connection.send`. That would also fire for the
coalescer's own flush (re-entrancy) and for sends outside the handler, and the
`message_end` path sends from a `setTimeout` where "before the early return" is
already too late.

### D6 — `maybeInlineAssistantImages` moves into the send callback

Today it runs per source update (`bridge.ts:2473`). Moving it into the
coalescer's `send` callback runs it once per flushed window instead — the same
O(N)→O(N/window) saving as the stringify. It runs BEFORE the flushed
`connection.send`, so its `asset_register` messages still precede the snapshot
that references them (the inliner's contract at `bridge.ts:743`), and
`getEmittedAssetHashes` dedupes per session so the retained `message_end`
inliner (`bridge.ts:2436`) cannot double-emit. That one stays: it is the
authoritative final-content replacement and runs once anyway.

Inlining against the mutated live object is consistent with D2: it mutates the
same message the final snapshot will carry.

### D7 — One `setTimeout` per armed window, owned by the coalescer

The coalescer arms a single injected `setTimeout(window)` when it parks into an
empty slot, and cancels it on flush or clear. No shared sweep.

*Why:* a shared 50 ms `setInterval` sweep cannot satisfy the spec's "no snapshot
is delayed by more than one window past its arrival" — a slot armed just after a
tick waits `interval + window` ≈ 100 ms, i.e. two windows. Shrinking the sweep
granularity trades the bound against an always-on timer. One timer per armed
window is both simpler and exactly bounded, and only one message streams at a
time per session, so "N timers" was never more than one per session anyway.

Lifecycle: the timer is injected (unit tests drive a fake clock) and the bridge
registers its cancel with the existing bridge-timer registry (`prev.timers`,
`bridge.ts` initBridge) plus the `session_shutdown` reset path that already
resets `subagentFrameBuffer` / `subagentTickThrottle`. The send callback checks
`isActive() && sessionReady` before writing, so a timer that outlives its bridge
cannot write to a dead socket.

### D8 — Reconnect flushes; session switch clears

`onReconnect` (`bridge.ts:1483`) flushes **before** state sync and replay. A
reconnect is a *transport* boundary: the live content is still valid, so
dropping it would lose the tail of an in-flight turn; but it must not land after
replayed history. `session_start` / shutdown / reload call `clear(gen)` instead —
a *session* boundary invalidates the content itself.

### D9 — The server's replay-compaction coupling is an explicit invariant

`replay-compaction.ts:82-96` exempts **the last text-bearing `message_update`
before each `tool_execution_start`** from compaction because it seeds the
reducer's `flush-<toolCallId>` row. D3's flush-then-forward preserves it — the
latest snapshot is written immediately before the tool event — but only as a
side effect, so it is named here and asserted by its own scenario. Losing it
would blank the text that precedes a tool call on replay, with no bridge-side
symptom.

## Risks / Trade-offs

- **Ghost streaming bubble** (a snapshot lands after `message_end`, re-filling
  the client's cleared `streamingText`) → D4's generation+key drop plus D5's
  entry flush; covered by the closed-message-drop and
  `bridge-followup-chat-order` tests.
- **Swallowed final snapshot** (a pending snapshot dropped instead of flushed at
  `message_end`) → `message_end` flushes *before* `messageEnd(gen, key)` closes;
  asserted by a test that the last text of a turn always reaches the wire.
- **Added latency** ≤ 50 ms, bounded and non-cumulative → verified perceptually
  before accepting the constant (task 1 / task 8).
- **A new early-returning branch in the enriched handler** → D5 makes the flush
  handler-scoped, not branch-scoped, so a new branch inherits it.
- **Regression surface**: `provider-retry-state` asserts a bridge wire-ordering
  invariant and the subagent frame tests assert buffering/flush. Both MUST stay
  green; they are the canary for D5. `bridge-followup-chat-order.test.ts`
  ALREADY EXISTS (215 LOC, deferred-start-vs-deferred-end drain ordering) — this
  change must not overwrite it; the new ordering test gets its own file.
  `bridge-queue-update-forward.test.ts` is a reduced local model of the forward
  site with its own `forward()` and no bridge import, so it is unaffected — but
  it survives only because its synthetic events carry no `assistantMessageEvent`
  (D3 classifies those as non-text → immediate forward).
- **Blanked pre-tool text on replay** (D9) → flush-then-forward keeps the
  seeding snapshot; asserted directly.
- **A flushed snapshot carries slightly-early content** (D2's accepted aliasing)
  → unobservable under last-wins cumulative snapshots; the alternative costs a
  serialisation per token, which is the cost being removed.
- **`message.timestamp` missing or unstable** would collapse every key and
  swallow a whole turn → the field is required in `pi-ai` types and set at
  partial creation; the implementation still asserts it and falls back to a
  per-message counter rather than keying on `undefined`.
- **Measurement is the gate** → if D0 shows the upstream consumer-side layers
  already capture the win, the correct outcome is to stop, not to ship.

## Migration Plan

Pure extension change. Land → `npm run reload` (no server restart, no client
build). Rollback is a revert + `npm run reload`; no persisted state, no protocol
version, no data migration.

`npm run reload` reloads every connected session, including ones mid-turn. D4's
lazy open is what makes that safe: the fresh bridge instance missed the in-flight
`message_start`, and without lazy open the rest of that turn would be silently
dropped.

## Open Questions

- Whether `COALESCE_WINDOW_MS` stays at 50 after the task-8 perceptual check, or
  moves to 33/80. Deferrable: it is a single constant and changes neither the
  specs (which say "fixed window", with 50 as the stated value) nor the task
  breakdown.
