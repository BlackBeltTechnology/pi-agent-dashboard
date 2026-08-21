## ADDED Requirements

### Requirement: Subscribe-time replay MAY be bounded to a configured window

When `memoryLimits.maxReplayEvents` is greater than zero, the server SHALL deliver at most that many events per full-stream subscription, as a head segment plus a tail segment with an elided middle. When the value is zero, replay SHALL be unbounded and behavior SHALL be identical to the prior implementation.

#### Scenario: Windowing disabled by default

- **WHEN** `maxReplayEvents` is `0` and a client subscribes to a session with 50000 stored events
- **THEN** the server SHALL replay all 50000 events
- **AND** the server SHALL NOT emit a `history_window` message carrying a non-zero `gapCount`

#### Scenario: Window applied to a full stream

- **WHEN** `maxReplayEvents` is `500` and a client subscribes with `lastSeq: 0` to a session whose compacted stream holds 5000 events
- **THEN** the server SHALL deliver at most 500 events
- **AND** the delivered events SHALL comprise a head segment beginning at the lowest stored seq and a tail segment ending at the highest stored seq

#### Scenario: Session smaller than the window is delivered whole

- **WHEN** `maxReplayEvents` is `1000` and the compacted stream holds 40 events
- **THEN** the server SHALL deliver all 40 events exactly once
- **AND** the server SHALL NOT emit a `history_window` message at all, because no window was applied
- **AND** no event SHALL appear more than once in the delivered stream

### Requirement: Windowing is determined by stream content, not by call site

The server SHALL apply the window when the array being delivered is a full stream, and SHALL NOT apply it when the array is a delta. A subscription carrying `lastSeq` of `0` SHALL be treated as a full stream even though it is served by the same branch as deltas.

#### Scenario: Warm reload with no cached cursor is windowed

- **WHEN** a client subscribes with `lastSeq: 0` to a session the server already holds in memory
- **THEN** the server SHALL apply the configured window

#### Scenario: Genuine delta is never windowed

- **WHEN** a client subscribes with `lastSeq` greater than `0` and not greater than the server's max seq
- **THEN** the server SHALL deliver every event after `lastSeq` without applying a window
- **AND** the delivered seq range SHALL contain no gap relative to `lastSeq`

### Requirement: The replay high-water mark is derived from the full input

`sendEventBatches` SHALL return the highest seq of the array it received, computed before compaction and before windowing.

#### Scenario: High-water mark survives an elided top

- **WHEN** compaction or windowing removes the highest-seq event from the delivered stream
- **THEN** the returned high-water mark SHALL still equal the highest seq of the input array
- **AND** the subsequent catch-up query SHALL return no events

### Requirement: A windowed replay announces its gap

On every full-stream path the server SHALL emit exactly one `history_window` message per subscriber before the first `event_replay` batch, reporting `headMaxSeq`, `tailMinSeq`, `gapCount`, and `oldestGapSeq`. `gapCount` SHALL be the number of gap events the store actually holds, never the arithmetic seq distance between the segments.

#### Scenario: Gap announced before batches

- **WHEN** a windowed replay begins for a subscriber
- **THEN** the subscriber SHALL receive `history_window` before any `event_replay` for that session

#### Scenario: Delta subscribe emits no window message

- **WHEN** a client subscribes with `lastSeq` greater than `0`
- **THEN** the server SHALL NOT emit a `history_window` message

#### Scenario: gapCount excludes events the store has trimmed

- **WHEN** the store has already trimmed part of the middle of a session, so the stored array is non-contiguous
- **THEN** the reported `gapCount` SHALL equal the number of gap events still present in the store
- **AND** `gapCount` SHALL be less than `tailMinSeq - headMaxSeq - 1`

### Requirement: A windowed replay resets client state explicitly

When a window is applied on a subscription carrying `lastSeq` of `0`, the server SHALL send `session_state_reset` before the replay.

#### Scenario: Reset precedes a windowed replay

- **WHEN** a window is applied for a client subscribing with `lastSeq: 0`
- **THEN** the client SHALL receive `session_state_reset` before the first delivered event
- **AND** the resulting transcript SHALL contain no rows from a prior subscription

### Requirement: Window segment boundaries snap inward

The tail segment's leading edge SHALL snap forward to the next `message_start` or `turn_start`, and the head segment's trailing edge SHALL snap backward to a completed `message_end`, each within a bounded lookup. Neither snap SHALL increase the number of delivered events beyond the configured limit.

#### Scenario: Delivered count never exceeds the configured limit

- **WHEN** `maxReplayEvents` is `500` and boundary snapping is applied
- **THEN** the number of delivered events SHALL be less than or equal to `500`

#### Scenario: Tail opens on a message boundary

- **WHEN** the computed tail cut falls in the middle of an assistant message and a `message_start` exists within the lookup bound
- **THEN** the first delivered tail event SHALL be that `message_start`

### Requirement: The client reducer tolerates orphaned events at a window edge

Replay SHALL NOT fail when a delivered segment begins or ends on an event whose structural partner was elided.

#### Scenario: Orphaned message_end does not crash the reducer

- **WHEN** a delivered segment begins with a `message_end` whose `message_start` was elided
- **THEN** the reducer SHALL produce a state without throwing

#### Scenario: Orphaned tool_execution_end does not crash the reducer

- **WHEN** a delivered segment begins with a `tool_execution_end` whose `tool_execution_start` was elided
- **THEN** the reducer SHALL produce a state without throwing

### Requirement: A windowed replay is not persisted to the client replay cache

When a window has been applied to a session's replay, the client SHALL NOT write that session's events to the durable replay cache.

#### Scenario: Windowed session is not cached

- **WHEN** a client receives a `history_window` with `gapCount` greater than `0` and completes the replay
- **THEN** the client SHALL NOT persist that session's payload to the replay cache

#### Scenario: Reload after a windowed replay re-windows

- **WHEN** a client reloads after a windowed replay of a session whose payload would fit the cache byte cap
- **THEN** the client SHALL subscribe with `lastSeq: 0`
- **AND** the client SHALL receive a `history_window` announcing the gap again
