## Purpose

Brings the WARM (in-memory) replay path down to the COLD (on-disk) path's event shape. A live session buffer stores every assistant `message_update` as a FULL content snapshot, so reopening a large session replayed ~20k events where `state-replay.ts` synthesizes ~1k. A pure, replay-only compaction pass drops the snapshots a later `message_end` supersedes, without changing what the store keeps or what the client renders.
## Requirements
### Requirement: Replay stream drops superseded streaming updates

During subscribe replay the server SHALL apply a pure compaction pass to the stored event window before batching. The pass SHALL drop every `message_update` event whose owning message is finalized by a `message_end` occurring LATER in the same replay window. All other event types SHALL pass through untouched.

Compaction is replay-only: the in-memory event store SHALL retain the full event stream, so the live broadcast path, on-demand tool-output fetch, and status extraction are unaffected.

#### Scenario: Finalized message loses its intermediate updates
- **WHEN** the replay window contains `message_start`, 500 `message_update` events for assistant message M, and `message_end` for M
- **THEN** the compacted window SHALL contain `message_start` and `message_end` for M
- **AND** the compacted window SHALL NOT contain any `message_update` for M

#### Scenario: Non-message events pass through
- **WHEN** the replay window contains `tool_execution_start`, `tool_execution_end`, `turn_start`, `turn_end`, `stats_update`, and `session_compact` events
- **THEN** every one of those events SHALL be present in the compacted window, in the original order

#### Scenario: Compaction is idempotent
- **WHEN** the compaction pass is applied to an already-compacted window
- **THEN** the output SHALL equal the input

### Requirement: Still-streaming tail is preserved

A `message_update` whose owning message has NO later `message_end` in the replay window SHALL be preserved, so a browser subscribing mid-turn still renders the live streaming text.

#### Scenario: Mid-turn subscribe keeps the tail
- **WHEN** the replay window ends with `message_start` for message M followed by 12 `message_update` events and NO `message_end` for M
- **THEN** all 12 `message_update` events SHALL be present in the compacted window

#### Scenario: Finalized message and streaming tail in one window
- **WHEN** the window holds a completed message M1 (`message_start` … updates … `message_end`) followed by a streaming message M2 (`message_start` … updates, no end)
- **THEN** M1's updates SHALL be dropped
- **AND** M2's updates SHALL be preserved

### Requirement: Compaction preserves sequence numbers and replay ordering

Compaction SHALL NOT renumber events: every surviving event SHALL keep its original `seq`, and surviving events SHALL keep their original relative order. Dropped events leave seq gaps, which are valid.

`sendEventBatches` SHALL report the PRE-compaction highest seq of the window as the replay high-water mark, so suppression catch-up (`clearReplaying`) and the client `lastSeq` contract never re-send or skip events because of compaction.

#### Scenario: Seq values survive compaction
- **WHEN** events with seqs 1..100 are compacted and events 3..98 are `message_update` for a finalized message
- **THEN** the compacted window SHALL be seqs `[1, 2, 99, 100]`
- **AND** no surviving event's `seq` SHALL differ from its stored value

#### Scenario: High-water mark is the pre-compaction max
- **WHEN** the last event of the window (seq 100) is a `message_update` that compaction drops
- **THEN** `sendEventBatches` SHALL return `100`
- **AND** `clearReplaying` SHALL be called with `100`

### Requirement: Compacted replay yields an equivalent client SessionState

Reducing the compacted window with the client event reducer SHALL produce a `SessionState` deep-equal to reducing the raw window, for messages that are finalized within the window.

This requirement is the acceptance gate for whether reasoning/thinking `message_update` deltas may also be dropped: they SHALL be dropped only if the equivalence holds via `reconstruct-reasoning-on-replay`, and SHALL be preserved otherwise.

#### Scenario: Plain assistant message equivalence
- **WHEN** a stream of `message_start` + N text-delta `message_update` + `message_end` is reduced raw and compacted
- **THEN** the two resulting `SessionState` values SHALL be deep-equal

#### Scenario: Interleaved text/tool message equivalence
- **WHEN** the message has `[text, toolCall, text]` shape (the `streamingTextFlushed` reorder path)
- **THEN** the raw and compacted `SessionState` values SHALL be deep-equal

#### Scenario: Thinking-bearing message equivalence decides the thinking policy
- **WHEN** the message carries `thinking_start` / `thinking_delta` / `thinking_end` deltas on `message_update` and inline `thinking` blocks on its `message_end`
- **THEN** the compaction policy chosen SHALL be the one for which raw and compacted `SessionState` are deep-equal, including thinking row content, order, and `streamedLive` flags

### Requirement: Replay batch size

The server SHALL send replay events in batches of 200 events, reducing per-batch client React commits and WebSocket frames for large sessions.

#### Scenario: Batch count for a large window
- **WHEN** a compacted replay window holds 1,000 events
- **THEN** the server SHALL emit 5 `event_replay` batches
- **AND** only the final batch SHALL carry `isLast: true`
