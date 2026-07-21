# on-demand-session-replay Delta Specification

## ADDED Requirements

### Requirement: Bridge resume/reattach replay is bounded to a tail window
When a bridge re-registers a session (resume via `pi --session`, or reattach after a WS drop) and replays session history, it SHALL send only a bounded tail window of the most recent entries, in yielding batches, rather than the entire branch in one synchronous burst. Older history SHALL be served on demand via the existing `load_older` path, not eagerly re-forwarded by the bridge.

#### Scenario: Resume of a large session sends only the tail
- **WHEN** the bridge replays a session whose branch has far more entries than the tail budget
- **THEN** it SHALL send at most the tail-window budget of entries
- **AND** it SHALL yield to the event loop between batches so neither the bridge event loop nor the WebSocket send buffer saturates
- **AND** it SHALL still send `replay_complete` when the bounded replay finishes

#### Scenario: Older history remains reachable
- **WHEN** the user scrolls up past the replayed tail on a resumed session
- **THEN** the older window SHALL be served by the server's `load_older` handler from the in-memory or on-disk buffer
- **AND** the bridge SHALL NOT have re-forwarded that older history eagerly

#### Scenario: Small session replays fully within the budget
- **WHEN** the bridge replays a session whose branch fits within the tail-window budget
- **THEN** it SHALL send all entries (behavior unchanged for small sessions)
