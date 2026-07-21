# incremental-event-sync Delta Specification

## MODIFIED Requirements

### Requirement: Suppress live events during paginated replay

When the server sends a paginated `event_replay` stream to a browser WebSocket for a subscribe — the tail window on a cold subscribe (`lastSeq: 0`) or a delta replay on a warm subscribe (`lastSeq > 0`) — it SHALL suppress live `event` broadcasts to that specific WebSocket until the replay completes. Suppression applies whenever the server has a non-empty event set to replay (`events.length > 0`).

`event_replay` messages with `kind: "older"` (responses to `load_older`) SHALL NOT participate in suppression: they are sent outside the `markReplaying`/`clearReplaying` bookkeeping, and live `event` broadcasts continue uninterrupted while they are delivered. This is safe because older windows carry only seqs strictly below the client's already-established window start, and the client never advances its per-session `maxSeq` from `kind: "older"` events, so live interleave cannot corrupt the client's ordering invariants.

The suppression rule exists because the client's reset decision must not be corrupted by a live `event` interleaving between subscribe-replay batches. With tail-first loading, the suppressed span shrinks from the entire history to a single bounded window (≤ `2 × TAIL_WINDOW_EVENTS`), so the window during which a subscriber cannot receive live events is bounded and short.

#### Scenario: Cold subscribe suppresses live broadcasts only for the tail window
- **WHEN** browser B subscribes to session "s1" with `lastSeq: 0` and the in-memory event store holds 5 000 events
- **AND** the server sends the tail window (e.g. seqs 4601..5000) as paginated `kind: "tail"` batches
- **AND** a new live event with `seq: 5001` arrives mid-window
- **THEN** the server SHALL NOT send `event { seq: 5001 }` to browser B until the tail window's `isLast: true` batch is sent
- **AND** after the window completes, event 5001 SHALL reach browser B via the catch-up path
- **AND** the suppressed span SHALL cover only the tail window, not the full history

#### Scenario: Warm subscribe (delta) live event during replay is suppressed
- **WHEN** browser B subscribes to session "s1" with `lastSeq: 50` and the server starts replaying events 51..100
- **AND** a new live event with `seq: 101` arrives during the replay
- **THEN** the server SHALL NOT send `event { seq: 101 }` to browser B until the replay batch with `isLast: true` has been sent
- **AND** after replay completes, the server SHALL resume live broadcasting to browser B
- **AND** the server SHALL send event 101 to browser B (either as part of a catch-up `event_replay` if it falls within range, or as a live event after replay)

#### Scenario: load_older delivery does not suppress live events
- **WHEN** browser B is subscribed to a streaming session and requests `load_older`
- **AND** live events arrive while the older window is being sent
- **THEN** the server SHALL broadcast the live events to browser B immediately (no suppression)
- **AND** the older window SHALL be delivered concurrently with `kind: "older"`

#### Scenario: Other browsers not replaying receive live events immediately
- **WHEN** browser A is subscribed and not replaying, and browser B is mid-replay (cold or warm)
- **AND** a new live event arrives
- **THEN** the server SHALL broadcast the event to browser A immediately
- **AND** the server SHALL suppress the event for browser B until B's replay completes

#### Scenario: Events during suppression are not lost — catch-up batch
- **WHEN** events arrive while browser B is mid-replay of its tail window
- **THEN** all events SHALL be stored in the event store
- **AND** after the window completes, the server SHALL send them to browser B as a single `event_replay { isLast: true }` catch-up batch (via `clearReplaying(ws, sessionId, lastSent)`)

#### Scenario: Empty event set — no suppression marker set
- **WHEN** browser B subscribes to a session whose event store exists but is empty (`events.length === 0` for the subscribe range)
- **THEN** the server SHALL NOT call `markReplaying` for that WebSocket+session pair
- **AND** any subsequent live `event` SHALL be broadcast to browser B immediately

### Requirement: Server detects stale lastSeq
When a browser subscribes with a `lastSeq` greater than the server's highest stored seq for a session, the server SHALL send `session_state_reset` followed by a tail-window replay (`kind: "tail"`, with `hasOlder` metadata) instead of a full replay from seq 1.

#### Scenario: Client has higher seq than server (server restarted)
- **WHEN** a browser subscribes with `lastSeq: 500` but the server's max stored seq for the session is `10`
- **THEN** the server SHALL send `session_state_reset` for that session
- **AND** the server SHALL send the tail window with `kind: "tail"` (which, for ≤ budget stored events, covers all events with `hasOlder: false`)

#### Scenario: Client lastSeq within server range
- **WHEN** a browser subscribes with `lastSeq: 50` and the server has events up to seq `100`
- **THEN** the server SHALL replay events 51..100 with `kind: "delta"` (no reset)
