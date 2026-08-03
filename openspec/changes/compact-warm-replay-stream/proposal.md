## Why

Reopening a large session replays the raw live event stream from the in-memory store: a 3.6 MB session file becomes 20,029 events / ~87 MB / 401 WebSocket batches over ~17.8 s on localhost (issue #399). The same session cold-loaded from disk yields 997 events in 26 ms — the warm path is ~20× worse than the cold path, because ~93% of replayed events are intermediate `message_update` snapshots that carry the FULL accumulated message (quadratic bytes on long messages) and are dead weight once the message has a `message_end`.

## What Changes

- Add a pure, seq-preserving replay compaction pass applied in `sendEventBatches`: drop `message_update` events belonging to a message that is already finalized by a later `message_end` inside the replay window. Keep `message_start` / `message_end`, tool lifecycle, turn/session markers, and the still-streaming tail (updates with no terminating `message_end`).
- Whether reasoning/thinking `message_update` deltas are also dropped (relying on `reconstruct-reasoning-on-replay` to rebuild thinking rows from the finalized message's inline `thinking` blocks) is decided by a reducer-equivalence test, not by assumption.
- `sendEventBatches` reports the PRE-compaction max seq so the replay-suppression catch-up (`clearReplaying`) and the client's `lastSeq` contract are unaffected by dropped events.
- Raise `REPLAY_BATCH_SIZE` 50 → 200, cutting batch count (and therefore client React commits) ~4×.
- No change to the in-memory store contents: the full stream is retained for the live path, "Show full output", and status extraction. Compaction is replay-only, mirroring the existing `truncateToolResultForReplay` precedent.

## Capabilities

### New Capabilities
- `replay-stream-compaction`: replay-time removal of superseded streaming `message_update` events, with seq preservation, streaming-tail retention, and reducer-output equivalence guarantees.

### Modified Capabilities
- `incremental-event-sync`: replay batches may contain seq gaps; the highest-seq contract for suppression catch-up is restated in terms of the pre-compaction window, and the batch size changes 50 → 200.

## Discipline Skills

`performance-optimization` (measure-before/after on the replay path), `doubt-driven-review` (deleting events from a replay stream is hard to reverse once shipped), `review-code` (before commit).

## Impact

- `packages/server/src/browser-handlers/subscription-handler.ts` — `REPLAY_BATCH_SIZE`, `sendEventBatches` compaction hook, returned seq.
- New `packages/server/src/session/replay-compaction.ts` (pure function, sibling of `replay-truncate.ts`).
- Tests: new `packages/server/src/__tests__/replay-compaction.test.ts`, reducer-equivalence test crossing the server/client boundary, additions to `packages/server/src/__tests__/subscription-handler.test.ts`.
- Client: no code change required. `chat-event-render-batching`'s "Replay path unchanged" scenario stays true — batch size is a server constant, not a client coalescing change.
- No protocol change (`event_replay` shape unchanged), no migration, no persisted-format change. Rollback = revert; the client tolerates both compacted and uncompacted streams.
