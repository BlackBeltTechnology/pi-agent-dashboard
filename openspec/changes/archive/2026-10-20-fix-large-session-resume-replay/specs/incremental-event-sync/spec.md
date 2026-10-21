# Spec Delta

## MODIFIED Requirements

### Requirement: Bridge event count for skip-wipe detection
The bridge extension SHALL include an `eventCount` field in the `session_register` message, representing the number of conversation entries in the current session branch. A bridge that supports it SHALL also include `leafEntryId` (the id of the last entry of that branch) and `liveTailOpen` (true when a turn is in progress — the same value the bridge then uses for its own replay); both are optional. The server SHALL store `eventCount` as `lastEntryCount` (and `leafEntryId` with it) and compare against them on subsequent reconnects to decide whether to wipe the event store. A wipe SHALL be skipped only for a register that carries `leafEntryId`, which a bridge sends only when it also marks replayed events; a register without it SHALL always wipe. A cold hydration SHALL also record a fingerprint of the hydrated branch (entry count, leaf entry id, and the store's highest seq after the insert). A register SHALL skip the wipe for that fingerprint only when `eventCount` and `leafEntryId` match it, `liveTailOpen` is `false`, and the store has not changed since the hydration. The kept store then equals what the bridge replay would have stored, apart from event timestamps and context-window metadata, which are accepted differences.

#### Scenario: Event count matches — skip wipe
- **WHEN** bridge reconnects with `session_register { sessionId: "s1", eventCount: 200, leafEntryId: "e200" }` and the server's stored `lastEntryCount` and leaf for session "s1" are `200` and `"e200"`, recorded by an earlier bridge register, and events exist in the event store
- **THEN** the server SHALL NOT call `deleteEventsForSession("s1")`
- **AND** the server SHALL NOT send `session_state_reset` to browsers at register
- **AND** the server SHALL leave bridge replay mode after receiving `replay_complete`

#### Scenario: Event count mismatch — full wipe
- **WHEN** bridge reconnects with `session_register { sessionId: "s1", eventCount: 150 }` but the server's stored `lastEntryCount` for "s1" is `200`
- **THEN** the server SHALL call `deleteEventsForSession("s1")`
- **AND** the server SHALL send `session_state_reset` to browser subscribers

#### Scenario: No eventCount provided — full wipe (backward compat)
- **WHEN** bridge reconnects with `session_register` without `eventCount`
- **THEN** the server SHALL perform the existing full wipe behavior

#### Scenario: Session ID changed — always full wipe
- **WHEN** bridge reconnects with a different `sessionId` than previously registered on the same WebSocket
- **THEN** the server SHALL perform the full wipe regardless of `eventCount`

#### Scenario: Old bridge with a matching eventCount — full wipe
- **WHEN** a bridge that sends no `leafEntryId` reconnects with an `eventCount` equal to the stored `lastEntryCount`
- **THEN** the server SHALL perform the full wipe

#### Scenario: Resume after browsing a cold session — skip wipe
- **WHEN** an ended session was cold-hydrated from a transcript whose branch has 6,531 entries and leaf entry id `e-last`, and nothing was inserted for it since
- **AND** a bridge then registers it with `eventCount: 6531`, `leafEntryId: "e-last"`, `liveTailOpen: false`
- **THEN** the server SHALL NOT wipe the stored events and SHALL NOT send `session_state_reset`
- **AND** the replayed events SHALL NOT be inserted again

#### Scenario: Hydration-learned fingerprint with a different leaf — full wipe
- **WHEN** a cold-hydrated session is registered with a matching `eventCount` but a different `leafEntryId`
- **THEN** the server SHALL perform the full wipe

#### Scenario: Hydration-learned fingerprint while a turn is in progress — full wipe
- **WHEN** a cold-hydrated session is registered with matching `eventCount` and `leafEntryId` but `liveTailOpen: true`
- **THEN** the server SHALL perform the full wipe, so the bridge's still-open tool calls replace the hydration's closed ones

#### Scenario: Old bridge without leafEntryId after cold hydration — full wipe
- **WHEN** a cold-hydrated session is registered with a matching `eventCount` but no `leafEntryId` or no `liveTailOpen`
- **THEN** the server SHALL perform the full wipe

#### Scenario: Store changed after hydration — full wipe
- **WHEN** a cold-hydrated session receives a server-synthesized event (for example a session-end heal event) and is then registered with a matching fingerprint
- **THEN** the server SHALL perform the full wipe

#### Scenario: Transcript without a resolvable leaf records no fingerprint
- **WHEN** a cold hydration reads a transcript whose branch has no entry id
- **THEN** no fingerprint SHALL be recorded and the next register SHALL perform the full wipe

## ADDED Requirements

### Requirement: The bridge marks replayed events
Every `event_forward` a bridge sends as part of replaying history — the session-entry replay after a register, reconnect, or session switch, and the ACP adapter's event-log replay — SHALL carry `replay: true`. Live forwards SHALL NOT carry it. The field is optional; a server that does not know it ignores it.

#### Scenario: Reconnect replay is marked
- **WHEN** the bridge reconnects and replays the session branch
- **THEN** every `event_forward` of that replay SHALL carry `replay: true`
- **AND** `event_forward` messages sent after `replay_complete` SHALL NOT carry it

#### Scenario: ACP reattach replay is marked
- **WHEN** the ACP adapter replays its durable event log after a reattach
- **THEN** every replayed `event_forward` SHALL carry `replay: true`

### Requirement: A register supersedes an in-flight cold hydration
When a bridge registers a session while a cold hydration of that session is loading or about to write its result, the hydration result SHALL NOT be inserted into the event store. The bridge replay SHALL be the only source of the session's events, and subscribers SHALL receive it through the replay exit flush.

#### Scenario: Register during a slow cold load
- **WHEN** a browser subscribes to an ended session with a 20,000-entry transcript and the bridge registers it before the load finishes
- **THEN** the event store SHALL hold only the events from the bridge replay, with no hydrated copy alongside them

#### Scenario: Register after the load resolved but before its insert
- **WHEN** the cold load has resolved but its result has not been inserted when the bridge registers
- **THEN** the hydrated result SHALL be dropped

#### Scenario: Register during the hydration fan-out
- **WHEN** the hydration has been inserted and is still sending batches to subscribers when the bridge registers and the register wipes
- **THEN** no batch of the hydration fan-out SHALL reach a browser after the register's `session_state_reset`

### Requirement: No cold hydration during a bridge replay
A browser subscribe that arrives while the session is in bridge replay mode SHALL NOT start a cold hydration, whatever load source the session has, and SHALL NOT mark the data unavailable. If the store holds events, the subscribe SHALL be served from the store as today. If it is empty, the server SHALL send `event_replay { events: [], isLast: false }` at once and keepalives until the replay exit flush ends with `isLast: true`.

#### Scenario: Subscribe after register, before the first replayed insert
- **WHEN** a bridge has registered a session and a browser subscribes before any replayed event is stored
- **THEN** no cold hydration SHALL start
- **AND** the browser SHALL receive `event_replay { events: [], isLast: false }` at once, hydration heartbeats while it waits, and then the session's events from the replay exit flush ending with `isLast: true`
