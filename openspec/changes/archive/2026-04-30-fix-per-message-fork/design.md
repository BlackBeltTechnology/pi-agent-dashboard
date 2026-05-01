## Context

The dashboard's per-message ⑂ Fork button (in `ChatView.MessageBubble`) sends `resume_session { mode: "fork", entryId }` to the server, which calls `createBranchedSessionFile(sessionFile, entryId)` to write a pruned JSONL ending at `entryId`, then spawns `pi --fork <pruned-file>`. This pipeline is sound — the bug is upstream.

`entryId` on each chat bubble is supplied by the bridge extension (`packages/extension/src/bridge.ts`) which enriches `message_start` and `message_end` events with `entryId = ctx.sessionManager.getLeafId()`. In pi 0.69 the dispatch order changed:

```js
// pi 0.70.x — packages/coding-agent/src/core/agent-session.js _processAgentEvent:
await this._emitExtensionEvent(event);          // ← bridge handler runs here, inside an awaited extension dispatcher
this._emit(event);                              // sync legacy listeners
if (event.type === "message_end") {
    sessionManager.appendMessage(event.message); // ← entry id GENERATED HERE
}
```

The bridge's `message_end` handler currently does:

```js
await new Promise<void>(resolve => queueMicrotask(resolve));
const entryId = ctx.sessionManager?.getLeafId?.();
```

The `queueMicrotask` deferral was correct against pre-0.69 pi, where `_emit` was synchronous and `appendMessage` was the next synchronous statement. Now `_emitExtensionEvent` `await`s every handler; the microtask resolves *inside* that await, and `appendMessage` does not run until the awaited dispatcher returns. The bridge therefore reads the **previous** leaf — the entry id of the message before the one currently being emitted.

`message_start` enrichment never deferred at all, so its `getLeafId()` has always been "the leaf at message-start time" — i.e. the previous entry. The existing `fork-entryid-accuracy` capability codified this as intentional ("Scenario: message_start entryId unchanged"). It isn't — it's the same bug surfaced for user messages.

Net effect: every chat bubble's `entryId` is shifted by one. When `createBranchedSessionFile` walks parents up to and including the (wrong) target id, the resulting JSONL ends at N-1, and the bubble the user actually clicked is missing.

## Goals / Non-Goals

**Goals:**

- Every chat bubble (user OR assistant) carries the entry id of the entry the bubble represents in the persisted JSONL, on pi 0.70.x.
- ⑂ on a user bubble produces a forked session whose tail IS that user message.
- ⑂ on an assistant bubble produces a forked session whose tail IS that assistant message.
- The fix survives all four spawn mechanisms (tmux / wt / wsl-tmux / headless) — they share the same `createBranchedSessionFile` upstream of spawn.
- A regression test that round-trips a real (or realistic) pi 0.70 session and asserts the tail entry of the forked JSONL matches the click target.

**Non-Goals:**

- **No protocol changes.** `resume_session { mode: "fork", entryId }` is unchanged.
- **No spawn-pipeline changes.** `createBranchedSessionFile` + `pi --fork <file>` stays. Routing fork through `ctx.fork()` (extension command context) or RPC `{type:"fork"}` is a separate, future change. Tracked as future work; explicitly out of scope here.
- **No backporting to pi <0.70.** The dashboard's `pi-version-skew` already pins minimum to 0.70.0.
- **Not changing `position` semantics.** Pi's `ctx.fork()` has `before`/`at`; the dashboard's forkFrom-style `--fork <file>` ignores both. We don't introduce that distinction in this change.
- **No bridge-side editor restoration.** The user's prompt is NOT moved into the dashboard's input box. (Pi's interactive `/fork` does this; the dashboard intentionally does not.)

## Decisions

### D1: Capture entry id from the just-persisted message, not from `getLeafId()`

The bridge will hook `ctx.sessionManager.appendMessage` once per session (at `session_start`) and stamp the generated entry id on a per-message lookup. On `message_start` / `message_end`, the bridge reads the stamped id by reference identity on `event.message`.

**Why:** It's the only signal that exists *after* pi has assigned the id. `event.message` is the same object instance at both emit time and append time (pi mutates it in place adding `id` inside `appendMessage`). A `WeakMap<MessageObject, string>` populated by the wrapped append gives us O(1) lookup at emit time.

**Alternatives considered:**

| Option | Verdict | Why not |
|---|---|---|
| `setTimeout(0)` instead of `queueMicrotask` | rejected | Macrotask runs after every other event listener too; reorders bridge events relative to other listeners; tests would have to change emit ordering assumptions across many event types. |
| Defer to next `pi.on(...)` event tick | rejected | Fragile: a `message_end` that's the last event of a turn (no tool call, no agent_end follow-up before idle) would never get its id flushed until the next user prompt. |
| Read `ctx.sessionManager.getBranch()` and match by content | rejected | Brittle for identical messages (e.g. repeated "hi"); would also fail on tool result messages where content matches across turns. |
| Move to `ctx.fork()` via registered command + drop entryId enrichment for fork purposes | deferred | Bigger architectural change; out of scope (see Non-Goals). |
| Upstream PR adding `event.entryId` after append | deferred | Right answer long-term, but lands on someone else's schedule. We need the dashboard fix to ship without an upstream dependency. |

**Mechanism in detail:**

```ts
// in session_start handler, once per session:
const sm = ctx.sessionManager;
const origAppend = sm.appendMessage.bind(sm);
const idByMessage = new WeakMap<object, string>();
sm.appendMessage = (msg) => {
  const result = origAppend(msg);              // pi mutates msg adding id
  if (msg && typeof msg === "object" && (msg as any).id) {
    idByMessage.set(msg as object, (msg as any).id);
  }
  return result;
};
// store idByMessage on bridge context for later lookup
```

Then in the `message_start` / `message_end` enrichment:

```ts
const entryId = idByMessage.get(event.message as object) ?? ctx.sessionManager?.getLeafId?.();
```

The fallback to `getLeafId()` covers (a) non-persisted message types that pi emits but doesn't append, and (b) any future code paths that bypass `appendMessage`. For the persisted path the WeakMap wins.

### D2: Emit the enrichment AFTER the awaited handler chain completes

Because `ctx.sessionManager.appendMessage` runs on line 310 of pi's `_processAgentEvent` — *after* the awaited `_emitExtensionEvent` returns — the bridge handler must defer the `connection.send(enriched)` past that point. We use `queueMicrotask` to schedule the send, but the entry id is already captured (D1) so the timing only affects WHEN we send, not WHAT we send.

Actually: with D1, **timing of the send is irrelevant**. We can send immediately on the message_end emit, because the WeakMap will be populated by the time appendMessage runs *for the next event*, not this one. So we have a choice:

| Option | Description | Picked? |
|---|---|---|
| (a) Defer send to `setTimeout(0)` so WeakMap is populated before send | Send always carries correct id | **YES** |
| (b) Send immediately, accept that the very first send after each persisted message lags by one event | Simpler, but the first message_end after session start has no id at all | no |

We pick **(a) `setTimeout(0)` deferral on the SEND of the enriched message_end event** so that the entry id is in the WeakMap by the time we read it. For `message_start` (user messages, persisted only on the *next* `message_end` for the assistant — actually wait, let me re-check pi's persistence ordering).

Actually re-reading pi 0.70.2 `_processAgentEvent`: persistence happens **only on `message_end`**, not on `message_start`. User messages have no persistence point at `message_start` time — they're persisted at *their own* `message_end`. So:

- `message_start` for a user msg: `getLeafId()` returns the previous leaf, but the user msg has no id yet.
- `message_end` for the same user msg: `appendMessage` runs *after* the bridge handler.
- `message_start` for the assistant msg: previous leaf is now the user msg (which DOES have an id).
- `message_end` for the assistant: `appendMessage` runs *after* the bridge handler.

Conclusion: stamping must happen at **`message_end`** for the message itself. `message_start` enrichment can simply read the most recent value from `idByMessage` (for the just-finished previous message, when emitting the next message's start).

**Revised mechanism:**

- On every emit, the bridge schedules its `connection.send(...)` via `queueMicrotask` AFTER reading the entryId.
- `message_end` enrichment: defer SEND until `setTimeout(0)` so `appendMessage` has run; read entry id from `event.message.id` (pi mutates the in-flight object) OR from the WeakMap as a backup.
- `message_start` enrichment: capture `getLeafId()` at the start (current behavior), but the consumer-side semantic is now "the entry id of the entry that came *before* this start event," used only for non-fork purposes. Fork uses `message_end`'s id via the bubble's stored `entryId`.

Actually simplest of all: pi mutates `event.message` in place by adding `.id` inside `appendMessage`. So for `message_end`, deferring the send by one tick (`setTimeout(0)`) means `event.message.id` is populated. We don't even need the WeakMap.

**Final picked mechanism (simplest):**

```ts
// message_end:
setTimeout(() => {
  const entryId = (event.message as any).id ?? ctx.sessionManager?.getLeafId?.();
  const enriched = { ...event, entryId };
  connection.send(mapEventToProtocol(sessionId, enriched));
}, 0);
```

For `message_start`: same `setTimeout(0)` deferral — by the next macrotask, the user's message has been persisted (its `message_end` fired and wrote its id). Wait, no — `message_start` fires before the assistant *or* user has been persisted at all. For user messages specifically, `message_start` is emitted when the user sent text but pi hasn't called `appendMessage` yet (it does so on the matching `message_end`).

So a `setTimeout(0)` on `message_start` would still see no id, because pi enqueues append on `message_end`.

**Therefore the rule is:**

- `message_end` events: defer send by one macrotask, read `event.message.id` (now populated).
- `message_start` events: do NOT enrich with the message's own id (we don't know it yet); enrich only with the *previous leaf* and label that as e.g. `previousEntryId` if a consumer needs it. Fork doesn't need it — fork uses the `message_end` id.

**Effect on the chat UI:** Today, `event-reducer.ts` populates ChatMessage.entryId from `data.entryId` on both message_start (user) and message_end (assistant). After this change:

- Assistant ChatMessage: entryId comes from `message_end` (correct, post-persist).
- User ChatMessage: needs another path. Options:
  1. The reducer waits to stamp user.entryId until the matching `message_end` arrives (cumbersome — message_end is for the assistant turn, not the user message).
  2. The bridge **re-sends** the user message with its now-known id by listening for the next `appendMessage` for a user-role message and emitting a synthetic `message_meta { entryId }` event.
  3. The bridge wraps `appendMessage` and emits a NEW protocol event `entry_persisted { messageRef, entryId }` whenever a message gets persisted. Reducer matches by `messageRef` (e.g., the ChatMessage's stable id) and back-fills `entryId`.

**Picked sub-decision:** option 3, simplest data flow. The bridge wraps `appendMessage`, and emits a small `entry_persisted` event with the entry id and a stable per-emit nonce that the bridge stamps on the original `message_start` / `message_end` event. The reducer carries the nonce through ChatMessage, and on `entry_persisted` updates the matching ChatMessage's `entryId`.

### D3: Replace the encoded-bug test

`packages/extension/src/__tests__/fork-entryid-timing.test.ts` currently has three tests, two of which encode the bug as expected behavior:

- "deferred getLeafId() captures the post-persist entry ID" — was correct for old pi, now misleading.
- "immediate getLeafId() would capture the stale entry ID (demonstrates the bug)" — still demonstrates the bug, no change needed.
- "message_start should still capture entryId immediately (no deferral)" — encodes the bug; **delete or invert**.

Replace with tests that simulate the **D2** mechanism: a wrapped `appendMessage` plus `setTimeout(0)`-deferred send.

### D4: Add a JSONL round-trip regression test

In `packages/server/src/__tests__/`, add a test that:

1. Writes a synthetic JSONL with a known root → user → assistant → user → assistant chain (matches pi 0.70 schema, including the `parentId` linearization).
2. For each non-header entry id, calls `createBranchedSessionFile(file, entryId)`.
3. Asserts the resulting JSONL's last non-header entry equals the input id.

This test catches both the old N-1 bug (if entry ids regress) and any future drift in `createBranchedSessionFile`.

## Risks / Trade-offs

- **Risk**: Pi mutates `event.message` differently in some paths (e.g., custom messages persisted via `appendCustomMessageEntry`). → **Mitigation**: keep the WeakMap fallback (D1) for those paths; rely on `event.message.id` for the regular user/assistant/toolResult path that pi 0.70.2 takes.
- **Risk**: `setTimeout(0)` on every `message_end` send slightly reorders the dashboard's event stream relative to `tool_execution_start` if a tool call follows. → **Mitigation**: also defer `tool_execution_start` and `tool_execution_end` by `setTimeout(0)` to preserve order, OR leave the new `message_end` send as the only deferred one and accept that tool events for the same turn arrive *before* the message_end carrying their parent's entryId (the chat reducer already tolerates this — tool results are anchored by `toolCallId`, not by message order).
- **Risk**: Future pi versions may change emit/persist ordering again. → **Mitigation**: the WeakMap-on-`appendMessage` strategy works regardless of when `_emit` runs, because it reads the id from the persisted object after pi has stamped it; the `setTimeout(0)` only needs to be "after the macrotask in which pi calls appendMessage."
- **Trade-off**: We're not using `ctx.fork()` even though it's the architecturally cleaner path. We accept this so the fix is small, ship-able now, and doesn't change protocol or spawn behavior. A follow-up change can route fork through `ctx.fork()`.
- **Trade-off**: Adding a new `entry_persisted` event widens the bridge→server protocol slightly. We accept this in exchange for keeping the chat reducer simple (back-fill on a known-shape event vs. inferring from out-of-order `message_end`s).

## Migration Plan

1. Land bridge changes (D1, D2) and the `entry_persisted` event in one commit set, behind no flag.
2. Update the event reducer to back-fill `entryId` on `entry_persisted`.
3. Update `fork-entryid-timing.test.ts` (D3) and add the round-trip test (D4) in the same commit set.
4. Reload all live pi sessions (`npm run reload`) so existing sessions pick up the new bridge.
5. **Rollback**: revert the bridge change. The fork bug returns but no other functionality is harmed (the `entry_persisted` event is additive; reducer handles its absence gracefully).

## Open Questions

- Should we synthesize `entry_persisted` events during `state-replay.ts` for sessions reconnected after server restart? Replay already attaches the correct `entryId` on `message_start`/`message_end` from the persisted JSONL, so probably not — but worth verifying that replay-loaded ChatMessages match live-loaded ones after the change.
- Should the `previous-leaf-on-message_start` value be exposed to extensions for any other consumer, or can we drop the enrichment entirely on `message_start`? Need to grep usage in the dashboard codebase before deletion.
