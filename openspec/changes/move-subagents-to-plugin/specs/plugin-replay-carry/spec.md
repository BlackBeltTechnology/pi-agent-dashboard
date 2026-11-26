# Spec Delta

## Purpose

Lets a plugin carry the events it still needs across the gap of a windowed (head/tail) session replay, so plugin state that began before the tail renders correctly on load without core knowing the plugin's event types.

## ADDED Requirements

### Requirement: A plugin server SHALL be able to contribute gap events to a windowed replay

When a subscribe produces a windowed replay, the server SHALL call every registered replay-carry handler with the session id, the gap seq range and read access to the resident gap events, and SHALL send each plugin's result as one `plugin_event_carry { sessionId, pluginId, events }` frame. Only events of types the plugin owns SHALL be sent.

#### Scenario: Carry precedes the replay batches
- **GIVEN** a windowed session whose plugin handler returns gap seqs 9000 and 9100
- **WHEN** a browser subscribes
- **THEN** it SHALL receive `session_state_reset`, `history_window`, `plugin_event_carry` with seqs 9000 and 9100, then the `event_replay` batches

#### Scenario: A full-stream replay asks no plugin
- **WHEN** a subscribe replays the full stream without a window
- **THEN** no replay-carry handler SHALL be called and no `plugin_event_carry` SHALL be sent

#### Scenario: A plugin cannot carry another owner's event type
- **WHEN** a handler returns a gap event whose type the plugin does not own
- **THEN** that event SHALL NOT be sent and the refusal SHALL be counted

### Requirement: The carry frame SHALL precede the replay batches

A `plugin_event_carry` frame SHALL be sent after `history_window` and before the first `event_replay`, on the same delivery path and class as the `event_replay` batches, so it is never reordered after them.

#### Scenario: Carry not overtaken under back-pressure
- **GIVEN** a socket above the back-pressure threshold during a windowed subscribe
- **WHEN** the carry and replay batches are sent
- **THEN** the browser SHALL receive the carry before the first `event_replay`

### Requirement: Carried events SHALL be applied only through the owning plugin's reducer

The client SHALL apply a `plugin_event_carry` frame's events only through the reducer slice and session-event finalizer of the named plugin, in the order given. It SHALL NOT create chat rows from them or change the session's seq or gap bookkeeping; the finalizer MAY update an existing tool row. A later backfill of the same seqs SHALL leave the plugin state unchanged.

#### Scenario: Carried events leave the gap intact
- **GIVEN** a windowed session with a gap of 12019 events
- **WHEN** a carry of 90 events is applied
- **THEN** the gap divider SHALL still announce 12019 events and no chat row SHALL be added

#### Scenario: Backfill over a carried seq
- **GIVEN** `subagent_entry` index 5 at seq 9000 was carried
- **WHEN** the gap range containing seq 9000 is backfilled
- **THEN** the subagent timeline SHALL still hold index 5 once

### Requirement: Carried events SHALL be bounded in the plugin's priority order

A plugin's handler SHALL return events in priority order. The server SHALL send the longest prefix of each plugin's list within 2000 events and 2 MiB of serialized data per plugin per subscribe, and count every event dropped in `/api/health`.

#### Scenario: Identity frames survive the bound
- **GIVEN** the subagents handler returns 40 identity frames first, then 2500 entry events
- **WHEN** a browser subscribes
- **THEN** all 40 identity frames and the first 1960 entry events SHALL be sent, and 540 drops SHALL be counted

### Requirement: A failing carry handler SHALL NOT break the replay

When a replay-carry handler throws, or its result arrives more than 200 ms after the call, the server SHALL discard that plugin's carry, log it, and continue the replay.

#### Scenario: Handler throws
- **WHEN** a plugin's replay-carry handler throws during a subscribe
- **THEN** the subscriber SHALL receive the head and tail and no `plugin_event_carry` from that plugin

#### Scenario: Trimmed gap events cannot be carried
- **GIVEN** the store trimmed part of the gap
- **WHEN** a browser subscribes
- **THEN** only resident gap events SHALL be carried, and no error SHALL be raised
