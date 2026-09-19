# message-update-coalescer.ts — index

Transport-agnostic single-slot coalescer for pi's streaming `message_update`
text snapshots. pi's update carries the FULL accumulated text (not a delta), so
the bridge paid one `JSON.stringify` + `ws.send` per source token on pi's own
event loop — O(N²) bytes for an N-token turn. The bridge injects `send`, the
timer schedule/cancel and a liveness predicate, so every ordering rule is
provable with fake timers instead of only end-to-end.

Exports:

- `COALESCE_WINDOW_MS` = 50 — a FIXED window anchored at the FIRST pending
  update, never restarted. NOT a debounce: a continuous token stream never sees
  a 50 ms gap, so a debounce would starve and land the first snapshot only at
  `message_end`.
- class `MessageUpdateCoalescer<M = unknown>` — options `{send, setTimer,
  clearTimer, windowMs?, isActive?}`.
  - `keyOf(gen, message)` → `<gen>:<role>:<timestamp>`, falling back to a
    per-message WeakMap counter when `timestamp` is absent. `message.id` is
    unusable (pi stamps it only at post-handler persistence). The generation is
    folded INTO the key because a `message_update` carries no generation of its
    own — it can only be stamped with the counter's current value.
  - `messageStart(gen, key, message?)` / `messageEnd(gen, key)` — the lifecycle
    barrier. `messageEnd` also records the identity as CLOSED. The bridge flushes
    BEFORE closing, or the last text of a turn would be dropped. `messageStart`
    binds `message` to `gen`.
  - `bindGeneration(gen, message)` / `generationOf(message, fallback)` — the
    generation the message was OPENED under. A `message_update` carries no
    generation of its own, so without this binding a late update for an already
    closed message would be keyed under the counter's CURRENT value, miss the
    closed key and fail open — landing after the next message started. `fallback`
    covers a message this instance never saw open (`npm run reload` mid-turn).
  - `offer(event, gen)` — the TEXT family (`text_start`/`text_delta`/`text_end`)
    parks, last wins. EVERY other sub-event, including one this build does not
    recognise, flushes pending text then forwards immediately and unmodified —
    thinking deltas are additive, so coalescing them would swallow them.
  - `flush()` sync + idempotent; `clear()` for a session boundary.
  - The closed-identity drop is the ONLY drop. An update with no open message,
    or one whose identity was never seen open, OPENS one instead: `npm run
    reload` re-inits the bridge mid-turn and dropping there would silence the
    rest of the turn. Closed identities are a bounded FIFO (64).
  - At most one armed timer, released through `clearTimer` so a fired timer
    leaves no registry entry. `isActive()` is re-checked at FIRE time, so a
    window that outlives its bridge cannot write to a dead socket.
- `flushesParkedText(eventType)` — the bridge's handler-entry rule: every event
  EXCEPT `message_update` must flush parked text before its own handling runs.
  Named so the invariant is one unit-testable predicate rather than a scattered
  convention.
- `isTextSubEvent(event)` — sub-event classification (only the three `text_*`
  types are snapshot-carrying).

Consumers: `bridge.ts` — one instance per bridge; `message_update` routed via
`offer`; `flush()` at both handler entries, at the two out-of-loop chat sinks
and in `onReconnect`; `clear()` on session change and shutdown. Tests:
`__tests__/message-update-coalescer.test.ts` (fake-timer semantics) and
`__tests__/bridge-coalesced-chat-order.test.ts` (ordering model + source
contract).

See change: coalesce-bridge-message-update-snapshots (D1–D4, D7).
