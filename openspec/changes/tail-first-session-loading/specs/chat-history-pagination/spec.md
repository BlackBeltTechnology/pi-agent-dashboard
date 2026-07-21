# chat-history-pagination Specification

## ADDED Requirements

### Requirement: Tail-first initial replay window
When a browser subscribes with `lastSeq: 0` to a session whose events are available (in memory or after a cold disk load), the server SHALL send only the newest window of events (the tail window) as `event_replay` batches carrying `kind: "tail"` and `hasOlder` metadata, instead of streaming the full history from seq 1.

The tail window SHALL target a budget of `TAIL_WINDOW_EVENTS` events, with the window start extended backward to the nearest safe cut point (a position where no assistant-message span and no tool span is open), bounded by a hard cap of `2 × TAIL_WINDOW_EVENTS`. When no safe cut point exists within the cap, the window SHALL start at the cap boundary.

#### Scenario: Cold-start subscribe receives only the tail window
- **WHEN** a browser subscribes with `lastSeq: 0` to a session with 5 000 stored events and `TAIL_WINDOW_EVENTS = 200`
- **THEN** the server SHALL send `event_replay` batches covering only the newest window (≥ 200 events, ≤ 400 events, snapped to a safe cut point)
- **AND** each batch SHALL carry `kind: "tail"`
- **AND** the final batch SHALL carry `isLast: true` and `hasOlder: true`

#### Scenario: Small session sends everything as the tail
- **WHEN** a browser subscribes with `lastSeq: 0` to a session with 80 stored events (fewer than the budget)
- **THEN** the server SHALL send all 80 events with `kind: "tail"` and `hasOlder: false`

#### Scenario: Window start snaps to a safe cut point
- **WHEN** the naive budget boundary falls between a `tool_execution_start` and its `tool_execution_end`
- **THEN** the server SHALL extend the window start backward to the nearest position where no message or tool span is open, not exceeding `2 × TAIL_WINDOW_EVENTS`

### Requirement: Older-history request/response contract
The client SHALL request older history via a `load_older { sessionId, beforeSeq }` message. The server SHALL respond with a single `event_replay { kind: "older", events, hasOlder, isLast: true }` covering a bounded window of events with `seq < beforeSeq`, selected with the same budget-and-safe-cut rule as the tail window. `hasOlder: false` SHALL indicate that the window reaches seq 1 (no more history).

#### Scenario: load_older returns the previous window
- **WHEN** the client sends `load_older { sessionId: "s1", beforeSeq: 4801 }` and the store holds events 1..5000
- **THEN** the server SHALL reply with an `event_replay` carrying `kind: "older"`, events ending at seq 4800, window sized by the budget rule, and `hasOlder: true`

#### Scenario: Final page signals end of history
- **WHEN** a `load_older` window's start reaches seq 1
- **THEN** the response SHALL carry `hasOlder: false`
- **AND** the client SHALL NOT issue further `load_older` requests for that session

#### Scenario: load_older for an unavailable session degrades safely
- **WHEN** the client sends `load_older` for a session whose events are not in memory and cannot be loaded (no `sessionFile` / load failure)
- **THEN** the server SHALL reply with `event_replay { kind: "older", events: [], hasOlder: false, isLast: true }`

#### Scenario: load_older awaits an in-flight cold buffer fill
- **WHEN** a `load_older` arrives while the cold-load buffer fill for that session is still inserting events into the store
- **THEN** the server SHALL answer after the fill completes, from the fully populated store

### Requirement: Older windows bypass live-event suppression
`event_replay` messages with `kind: "older"` SHALL be sent outside the replay-suppression bookkeeping (`markReplaying`/`clearReplaying`). Live `event` broadcasts SHALL continue uninterrupted to a subscriber while older windows are being delivered.

#### Scenario: Live streaming continues during older-page delivery
- **WHEN** a session is actively streaming and the client requests `load_older`
- **THEN** live `event` messages SHALL continue to be broadcast to that WebSocket while the older window is delivered
- **AND** the client SHALL NOT advance its per-session `maxSeq` from `kind: "older"` events

### Requirement: Client prepend and full refold on older windows
On receiving `event_replay { kind: "older" }`, the client SHALL prepend the window to its per-session raw event buffer (dedup by seq) and rebuild `SessionState` by re-reducing the entire raw buffer from initial state. The client SHALL NOT fold an older window incrementally into existing reduced state. The plugin-runtime per-session event store SHALL be cleared and re-published from the full buffer so `useSessionEvents` consumers observe a consistent ordered stream.

#### Scenario: Older window rebuilds state from the full buffer
- **WHEN** the client holds reduced state built from events 4601..5000 and receives an older window 4201..4600
- **THEN** the client SHALL re-reduce from `createInitialState()` over events 4201..5000
- **AND** `messages` SHALL contain the older turns before the newer turns in order

#### Scenario: Orphan span fragments at a capped cut are dropped
- **WHEN** the oldest loaded window starts at an unsafe cut (hard cap reached) and begins with `message_update` / `tool_execution_end` events whose spans opened before the window
- **THEN** the client fold entry SHALL skip leading events that reference unopened spans without throwing

#### Scenario: Duplicate older page is idempotent
- **WHEN** the client receives an older window whose seqs are already present in the raw buffer
- **THEN** the prepend SHALL deduplicate by seq and the refold SHALL produce identical state

### Requirement: Scroll-up trigger with single-flight and anchor preservation
The chat view SHALL request older history when the user scrolls near the top of the transcript while `hasOlder` is true, with at most one in-flight `load_older` per session. While a request is in flight, a slim top-of-transcript loading row SHALL render (not the full-screen history skeleton). After the prepend renders, the previously visible content SHALL remain visually anchored (no scroll jump).

#### Scenario: Scrolling to the top loads the previous page
- **WHEN** the user scrolls the transcript so the first visible row index falls below the trigger threshold and `hasOlder` is true
- **THEN** the client SHALL send exactly one `load_older { beforeSeq: <oldest loaded seq> }`
- **AND** a "loading older" row SHALL render at the top of the transcript

#### Scenario: No duplicate requests while in flight
- **WHEN** the user keeps scrolling at the top while a `load_older` response is pending
- **THEN** the client SHALL NOT send a second `load_older` for that session

#### Scenario: Prepend preserves the visual anchor
- **WHEN** an older window is prepended and the transcript re-renders
- **THEN** the row that was at the top of the viewport before the prepend SHALL remain at the same viewport offset

#### Scenario: End of history removes the affordance
- **WHEN** the client has received `hasOlder: false`
- **THEN** scrolling to the top SHALL NOT trigger further requests and no loading row SHALL render
