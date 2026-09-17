# Coalesce bridge `message_update` text snapshots with ordering guarantees

> **Provenance.** Ported from the `JessieKaa/pi-agent-dashboard` fork. The fork
> carries this as two changes squashed into commit `d4edb6d1b`
> ("preserve message update ordering across lifecycle boundaries"): the base
> `coalesce-message-update-text-snapshots` state machine plus the ordering /
> lifecycle hardening on top. The fork branched at `67111dfae` and is ~124
> commits behind; claims below were re-verified against current `origin/develop`.
> The fork diff is reference material, **not** a patch to cherry-pick.

## Why

1. **Every streaming token costs a full JSON stringify + `ws.send` on pi's event
   loop.** pi's `message_update` carries the **FULL accumulated text snapshot**,
   not a delta. `packages/extension/src/bridge.ts` forwards each one
   synchronously (`mapEventToProtocol` → `connection.send`) on the same
   single-threaded loop that runs the TUI, so a turn of N tokens is O(N²) bytes
   stringified and sent. The visible symptom is TUI jank and bridge-side event-loop
   stall during long assistant turns.
   *Upstream delta:* `develop` forwards `message_update` unbatched — the only
   handling at `bridge.ts:2470-2474` is `maybeInlineAssistantImages(event)`. The
   only throttle in the extension is `subagent-tick-throttle.ts` (subagent frames).
   **Note the overlap to resolve at plan time:** upstream already coalesces on the
   *consumer* side — `live-event-frame-coalescing-fold` (server fold) and
   `chat-event-render-batching` (client render batching). Those cut render cost;
   they do **not** cut the bridge's per-token stringify + send cost, which is what
   this change targets. The proposal must state that boundary explicitly and
   measure the bridge-side cost on `develop` before implementing, so the win is
   not double-counted.

2. **Naive coalescing reorders the stream and loses thinking deltas.** A
   last-wins window over *all* `message_update` sub-events would (a) drop the
   intermediate `thinking_delta` accumulations, which are additive and not
   snapshot-carrying, and (b) let a parked text snapshot land **after** the
   `message_end` that cleared the client's `streamingText`, re-filling it as a
   ghost streaming bubble. The fork hit both in practice — that is why the
   ordering hardening exists as a follow-up rather than being part of the base
   design.

3. **Lifecycle boundaries let a straggler leak into the next message.** Reload
   timers, reconnect replay, and session switch each create a window where an
   update belonging to a finished message can be forwarded after the next
   message's `message_start`, producing out-of-order follow-up chat lines.
   *Upstream delta:* `develop`'s bridge has a monotonic `generation` counter
   (`bridge.ts:143-249`) used only to make **stale listeners** bail out; it gives
   no ordering guarantee for message content, and there is no per-message
   open/close barrier.

## What Changes

- **New `packages/extension/src/message-update-coalescer.ts`** — a transport-
  agnostic single-slot state machine (only one assistant message streams at a time
  in pi). The bridge supplies `send`; timer schedule/cancel and the clock are
  injectable for fake-timer tests.
  - **TEXT family** (`text_start` / `text_delta` / `text_end`, and any other
    snapshot-carrying update) → single-slot pending, **last wins**, flushed after
    a **fixed 50 ms window** (`COALESCE_WINDOW_MS`). Fixed window, **not** a
    debounce: the window is anchored at the first pending event, so a long stream
    never starves and stays ≤ 50 ms behind.
  - **THINKING family** (`thinking_start` / `_delta` / `_end`), toolcall events and
    unknown update types → **flush any pending text first, then forward
    immediately**. Source order is preserved and thinking deltas stay lossless.
  - **Generation + key barrier** — the bridge stamps an incrementing generation on
    every `message_start` (assistant *and* user, so retry chains and new turns both
    reset the barrier) and supplies a stable `role:timestamp` message key.
    `messageStart(gen, key)` opens the stream; `messageEnd(gen, key)` closes it
    after the bridge flushes the final snapshot. Updates from an older generation,
    a different key, or a closed message are **dropped**. (pi clones `message` refs
    per event and `message.id` only exists after persistence, so object identity
    and early ids are unusable as keys.)
  - `flush()` is sync and idempotent; `clear(gen)` drops pending data, cancels the
    private timeout, and closes the lifecycle.
- **Bridge integration (`bridge.ts`)**
  - `flush()` at the entry of **every non-`message_update` handler** — including
    branches that early-return (`model_select`, `turn_end`, `message_end`,
    `message_start`, pass-through sends). This is the hard invariant that keeps a
    parked snapshot from landing after a `message_end`.
  - `message_start` → `assistantMessageGen++` + `messageStart(gen, key)`;
    `message_end` → `messageEnd(gen, key)`.
  - `onReconnect` → `flush()` **before** state sync and replay: reconnect is a
    transport boundary, not a session boundary, so live content is kept but can
    never appear after historical replay.
  - Session-scoped instance re-created on `session_start`; a single 50 ms sweep
    interval flushes all live instances (each slot carries its own arm time, so one
    timer cannot delay a window). Cancel the sweep + clear instances on session
    switch, shutdown and reload.
  - `maybeInlineAssistantImages` moves **into the coalescer's send callback** so it
    runs once per flushed window instead of per token; the `message_end` inliner
    stays for final-content replacement.

**Out of scope** — changing pi's snapshot-carrying `message_update` shape, the
subagent frame path (`subagent-tick-throttle.ts`, already throttled), and the
server/client-side fold and render-batching layers (they stay as-is).

## Capabilities

### Added Capabilities

- `bridge-message-update-coalescing` — the bridge SHALL coalesce only
  **contiguous** text snapshots within a fixed window, SHALL forward
  thinking/toolcall/unknown sub-events immediately after flushing pending text,
  and SHALL guarantee that a parked snapshot is on the wire before any non-update
  event of the same message. A snapshot from a closed or superseded message
  generation SHALL be dropped, so no lifecycle boundary (message end, reconnect
  replay, session switch, reload) can reorder message content.

## Impact

**Code**

- NEW `packages/extension/src/message-update-coalescer.ts` (~217 LOC) + its
  `.AGENTS.md` sidecar.
- `packages/extension/src/bridge.ts` (~+126 LOC) — instance ownership, sweep
  timer, `messageKeyOf(message)` helper, flush-at-handler-entry invariant,
  message_start/end barrier calls, reconnect flush, lifecycle clear.
- `packages/extension/src/AGENTS.md` + `bridge.ts.AGENTS.md` rows.

**Tests**

- NEW `__tests__/message-update-coalescer.test.ts` (~347 LOC) — window semantics
  (fixed, not debounce), last-wins within a contiguous run, thinking/toolcall
  flush-then-forward ordering, generation/key stale-drop, closed-message drop,
  idempotent `flush()`, `clear(gen)`.
- NEW `__tests__/bridge-followup-chat-order.test.ts` (~124 LOC) — the end-to-end
  ordering regression: a follow-up chat line after reload/resume arrives in order.
- Existing bridge tests (retry-state wire ordering in
  `specs/provider-retry-state`, subagent frame buffering/flush) MUST stay green —
  `provider-retry-state` asserts a **bridge wire-ordering invariant**, so it is the
  primary regression surface for this change.

**Risk**

- This is a wire-ordering change in the hottest bridge path; the failure mode is a
  ghost streaming bubble or a permanently swallowed final snapshot — both
  user-visible and both easy to miss without the ordering tests.
- Adds up to 50 ms of latency to streamed text (bounded, not cumulative). Verify
  against perceived streaming smoothness before accepting the window constant.
- Rebuild path: extension change → `npm run reload` (no server restart).

## Discipline Skills

- **`performance-optimization`** — the premise is a measured cost (O(N²)
  stringify + send per turn on pi's event loop). Measure the bridge-side cost on
  `develop` **before** implementing, and re-measure after, so the win is
  attributable to this layer rather than to the existing server-fold / render-batch
  layers.
- **`systematic-debugging`** — the ordering defects (late snapshot after
  `message_end`, straggler across reload/reconnect) must be reproduced red first;
  they are timing-dependent and cannot be validated by inspection.
- **`review-code`** — the flush-at-every-handler-entry invariant is enforced by
  convention across many branches; a new early-returning branch silently breaks it.
  Review should check the invariant explicitly and consider a structural guard.
- **`doubt-driven-review`** — the overlap question (does upstream's existing
  server-fold + render-batching already capture most of the win?) is the decision
  that must be settled before the change stands.

`security-hardening` (no untrusted input, secrets or auth surface — payload shapes
are unchanged) and `observability-instrumentation` (no new endpoint, job or
external call) do not apply.
