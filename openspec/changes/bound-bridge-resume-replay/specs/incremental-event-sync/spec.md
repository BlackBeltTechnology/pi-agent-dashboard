# incremental-event-sync Delta Specification

## ADDED Requirements

### Requirement: Replayed history is not re-broadcast as live frames on same-id resume
When the server processes a same-id resume replay, historical entries SHALL be routed into the event store and delivered to the subscribing browser through the batched, back-pressure-aware subscribe `event_replay` window — NOT as per-entry live `event` broadcasts. This prevents the server→browser WebSocket buffer from overflowing `MAX_WS_BUFFER` and silently dropping transcript frames.

#### Scenario: Large resume produces zero back-pressure drops
- **WHEN** a browser is subscribed to a session that is resumed and the bridge replays its history
- **THEN** the server SHALL NOT emit a live `event` broadcast per replayed entry
- **AND** the subscribing browser SHALL receive the bounded tail via `event_replay` batches
- **AND** the server-tracked `droppedFramesTotal` for that session SHALL remain zero

#### Scenario: replay_complete still terminates the cycle
- **WHEN** the bounded replay for a resumed session finishes
- **THEN** the server SHALL clear the replaying flag and resume normal live broadcasting for subsequent new events

### Requirement: Dropped-frame threshold emits a structured notice
When the count of back-pressure-dropped frames for a session crosses a small threshold, the server SHALL emit a structured notice exactly once (not per dropped frame) so a client can trigger a bounded re-subscribe instead of rendering a silently-truncated transcript.

#### Scenario: Notice emitted once past threshold
- **WHEN** dropped frames for a session cross the configured threshold
- **THEN** the server SHALL emit one dropped-frame notice for that session
- **AND** SHALL NOT emit a further notice for the same session until its drop count resets
