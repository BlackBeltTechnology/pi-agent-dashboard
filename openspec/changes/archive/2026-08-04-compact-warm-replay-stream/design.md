## Context

Issue #399. Reopening a large session replays the raw live stream from `createMemoryEventStore`. Verified against the code:

- `packages/server/src/browser-handlers/subscription-handler.ts:13` — `REPLAY_BATCH_SIZE = 50`, `BACKPRESSURE_THRESHOLD = 1 MB` (poll every 50 ms).
- `packages/server/src/persistence/memory-event-store.ts:61` — `DEFAULT_MAX_EVENTS_PER_SESSION = 20000`; the trim treats `message_update` as non-essential, but only fires ABOVE the cap.
- `packages/client/src/lib/chat/event-reducer.ts` `case "message_update"` — reads `data.message` and joins the FULL accumulated content into `streamingText`; each update is a snapshot, not a delta. Thinking rows are built from `data.assistantMessageEvent` (`thinking_start|delta|end`).
- `packages/shared/src/state-replay.ts:94` — the cold/disk path synthesizes exactly ONE `message_update` + `message_end` per message. This is why disk yields 997 events where memory yields 20,029.
- `packages/server/src/session/replay-truncate.ts` — precedent: replay already applies a pure, replay-only transform (`truncateToolResultForReplay`) inside `sendEventBatches`, with the store keeping the full body.

So the fix is a second replay-only transform on the same hook, not a new architecture.

## Goals / Non-Goals

**Goals:**
- Bring the warm replay path within the same order of magnitude as the cold path (~20 batches, < 1 s) for a large session.
- Guarantee byte-identical client `SessionState` for finalized messages.
- Keep the streaming tail, seq contract, and suppression/catch-up semantics intact.

**Non-Goals:**
- No change to store-insert behaviour (the full stream stays in memory for the live path, "Show full output", and status extraction).
- No client-side render coalescing of `event_replay` (the `chat-event-render-batching` spec explicitly froze that path; batch-size reduction gets most of the win without touching it).
- No protocol change, no persisted-format change, no bridge change.

## Decisions

### D1 — Positional supersession rule instead of message-identity matching
Events in a session buffer are strictly sequential, and an assistant `message_update` has no stable id at emit time (`entryId` is only stamped at `message_end`; `bridge.ts:1646` documents this). Therefore:

> Drop every `message_update` with `seq < seq(last message_end in the window)`.

Everything after the last `message_end` is by definition the still-streaming tail and is kept.

*Alternative considered:* the reporter's `message.role:message.timestamp` keying. Rejected — it depends on data fields that are optional/mutable, needs a two-pass index, and buys nothing over the positional rule.

*Risk:* if any non-conversation producer (subagent inner-timeline forwarding, flows) emits raw `message_update` interleaved with the parent's `message_end`, the positional rule would drop it. Mitigated by D3's equivalence test plus a dedicated subagent-interleave fixture; if that fires, the rule narrows to "drop `message_update` only when a later `message_end` exists AND no intervening `message_start`".

### D2 — Thinking deltas: policy decided by test, not by assumption
`reconstruct-reasoning-on-replay` already rebuilds thinking rows from the finalized message's inline `thinking` blocks, with a dedupe guard keyed on "does a thinking row for this turn already exist". If dropping thinking-carrying `message_update` events yields a deep-equal `SessionState` (rows, order, `streamedLive`), drop them — that approaches the 997-event cold-path shape. If not, exempt events whose `data.assistantMessageEvent.type` starts with `thinking` (the reporter's conservative variant, 20,029 → 7,092). The equivalence test is the arbiter and is written BEFORE the implementation.

### D3 — Equivalence test crosses the server/client boundary deliberately
The compaction function lives in `packages/server`, but its correctness is defined by the client reducer. The test imports both and asserts `deepEqual(reduceAll(raw), reduceAll(compacted))` over fixtures: plain text message, `[text, toolCall, text]` (the `streamingTextFlushed` reorder path), thinking-bearing message, mid-turn streaming tail, and a subagent-interleaved window. This is the only test that can justify deleting events.

### D4 — Report the pre-compaction max seq
`sendEventBatches` currently returns `stored[stored.length - 1].seq`. After compaction the last surviving event may have a lower seq, which would make `clearReplaying` re-send already-delivered events as a catch-up batch. The function computes the high-water mark from the PRE-compaction window and returns that.

### D5 — `REPLAY_BATCH_SIZE` 50 → 200
Purely a server constant. 401 batches → ~100 before compaction, ~5–20 after. Each batch is one client React commit, so this attacks the second half of the issue without violating the frozen "replay path unchanged" client scenario. Batch payload stays well under the 1 MB backpressure threshold once snapshots are gone.

## Risks / Trade-offs

- **Dropping a load-bearing update** → reducer-equivalence tests across five fixture shapes; positional rule narrows (D1) if the subagent fixture fails.
- **Thinking rows lost on replay** → explicitly gated by D2; conservative fallback preserved.
- **Seq-gap fallout in the client reset rule** → `getEvents` already filters by seq and tolerates gaps; monotonicity is preserved; covered by a spec scenario and a handler test.
- **Catch-up duplication** → D4 plus a handler test asserting `clearReplaying` receives the pre-compaction max.
- **Larger batches raise per-frame client work** → offset by ~97% fewer bytes; e2e budget test guards the end-to-end result.

## Migration Plan

Pure server-side behaviour change. No data migration. Compatible in both directions: an old client tolerates a compacted stream (it already handles the cold-load shape, which is sparser), and a new server tolerates any client. Rollback = revert the commit; nothing persists.

## Open Questions

- Should compaction also apply to the cold-load replay path (`loadSessionEvents` → `sendEventBatches`)? It is already compact, so the pass is a near no-op there; applying it uniformly is simpler and is the current plan.
- Should the trim in `memory-event-store` gain an insert-time compaction later (the issue's secondary suggestion)? Deferred — it changes live-path guarantees and is not needed to close #399.
