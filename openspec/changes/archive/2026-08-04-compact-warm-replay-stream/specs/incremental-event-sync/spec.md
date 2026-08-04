## MODIFIED Requirements

### Requirement: Suppress live events during paginated replay

When the server sends a paginated `event_replay` stream to a browser WebSocket — whether the subscribe was cold (`lastSeq: 0`, full replay of all stored events) or warm (`lastSeq > 0`, delta replay of seqs `> lastSeq`) — it SHALL suppress live `event` broadcasts to that specific WebSocket until the replay completes. Suppression applies whenever the server has a non-empty event set to replay (`events.length > 0`), evaluated on the PRE-compaction window (see `replay-stream-compaction`).

This rule exists because the client's `event_replay` reset rule

```
shouldReset = firstSeq != null && (firstSeq === 1 || firstSeq <= maxSeq)
```

uses a single per-session `maxSeq` that is bumped by both `event_replay` batches AND live `event` messages. If a live `event` interleaves between two paginated `event_replay` batches it advances `maxSeq` past the next batch's `firstSeq`, causing the next batch to misfire `shouldReset = true`, wipe the partially-built `SessionState`, and rebuild from only that batch's events. Net effect: the chat shows only the tail. Suppression+catch-up preserves the invariant that paginated `event_replay` batches arrive monotonically with no live-event interleaving on the same WebSocket.

Replay compaction may remove events from a batch, so batches MAY contain seq gaps. Gaps are valid and SHALL NOT affect the reset rule: seqs stay monotonically increasing across batches, and the replay high-water mark passed to `clearReplaying` is the PRE-compaction max seq of the window.

#### Scenario: Cold subscribe with stored events suppresses live broadcasts (regression)
- **WHEN** browser B subscribes to session "s1" with `lastSeq: 0` and the in-memory event store holds 228 events for "s1"
- **AND** the server begins sending paginated `event_replay` batches (200 per batch)
- **AND** a new live event with `seq: 105` arrives after the first batch (`firstSeq=1, lastSeq<=200`) but before the next batch
- **THEN** the server SHALL NOT send `event { seq: 105 }` to browser B until the paginated replay has completed (`isLast: true` sent)
- **AND** browser B's `maxSeqMap.get("s1")` SHALL NOT be advanced past the last replayed seq before the next batch arrives
- **AND** the next batch SHALL NOT trigger the `shouldReset` rule on the client

#### Scenario: Warm subscribe (delta) live event during replay is suppressed
- **WHEN** browser B subscribes to session "s1" with `lastSeq: 50` and the server starts replaying events 51..100
- **AND** a new live event with `seq: 101` arrives during the replay
- **THEN** the server SHALL NOT send `event { seq: 101 }` to browser B until the replay batch with `isLast: true` has been sent
- **AND** after replay completes, the server SHALL resume live broadcasting to browser B
- **AND** the server SHALL send event 101 to browser B (either as part of a catch-up `event_replay` if it falls within range, or as a live event after replay)

#### Scenario: Other browsers not replaying receive live events immediately
- **WHEN** browser A is subscribed and not replaying, and browser B is mid-replay (cold or warm)
- **AND** a new live event arrives
- **THEN** the server SHALL broadcast the event to browser A immediately
- **AND** the server SHALL suppress the event for browser B until B's replay completes

#### Scenario: Events during suppression are not lost — catch-up batch
- **WHEN** events with seqs 229, 230, 231 arrive while browser B is mid-replay (cold subscribe, paginated through seqs 1..228)
- **THEN** all three events SHALL be stored in the event store
- **AND** after the paginated replay completes, the server SHALL send events 229..231 to browser B as a single `event_replay { isLast: true }` catch-up batch (via `clearReplaying(ws, sessionId, lastSent)`)

#### Scenario: Compaction-dropped tail does not re-send events
- **WHEN** the replay window's highest-seq event is dropped by compaction
- **THEN** `clearReplaying` SHALL still receive that highest seq
- **AND** the catch-up batch SHALL NOT re-send any event at or below it

#### Scenario: Empty event set — no suppression marker set
- **WHEN** browser B subscribes to a session whose event store exists but is empty (`events.length === 0` for the subscribe range)
- **THEN** the server SHALL NOT call `markReplaying` for that WebSocket+session pair
- **AND** any subsequent live `event` SHALL be broadcast to browser B immediately
