# chat-history-loading-indicator Specification

## Purpose
Distinguish "history loading" from "genuinely empty session" in the dashboard chat view. The client tracks a per-session loading flag, set when `subscribe` is sent and cleared when content arrives, replay completes, the load fails, or a safety-net timeout elapses, so a loading indicator (not the "No messages yet" placeholder) shows while persisted history is in flight over a remote link. The behavior is primarily client-side, but the server now adds a periodic re-emission of the empty `event_replay { events: [], isLast: false }` marker (a hydration heartbeat) during cold session load; no new protocol message type or wire-schema change.
## Requirements
### Requirement: Distinguish loading history from empty session

The chat view SHALL render a loading indicator while a session's persisted history is in flight, and SHALL render the empty-session placeholder only when the session is genuinely empty. The client SHALL track a per-session loading flag that is set when a `subscribe` is sent and cleared when content arrives, replay completes, the load fails, or a safety-net timeout elapses.

#### Scenario: Loading indicator during history transfer

- **GIVEN** a user opens an old/ended session whose history has not yet arrived
- **WHEN** the client has sent `subscribe` and `state.messages` is still empty
- **THEN** the chat view SHALL render a loading indicator
- **AND** the chat view SHALL NOT render the "No messages yet" placeholder.

#### Scenario: Content replaces the indicator on first batch

- **GIVEN** the loading indicator is showing for a session
- **WHEN** the first non-empty `event_replay` batch is reduced into `state.messages`
- **THEN** the client SHALL clear the session's loading flag
- **AND** the chat view SHALL render the message bubbles.

#### Scenario: Genuinely empty session shows the placeholder

- **GIVEN** a session with no persisted history
- **WHEN** the only `event_replay` received is `{ events: [], isLast: true }`
- **THEN** the client SHALL clear the session's loading flag
- **AND** the chat view SHALL render "No messages yet".

### Requirement: Loading flag entry covers warm and cold subscribe paths

The client SHALL set the per-session loading flag at the point it sends
`subscribe`, independent of whether the server later emits an empty
`event_replay { isLast: false }` start marker. On the cold (disk-load) path the
empty `event_replay { isLast: false }` start marker SHALL additionally re-arm the
safety-net from the short acknowledgement window to the longer hydration ceiling.
The warm (in-memory replay / reconnect re-subscribe) path, which does not emit
that empty start marker, SHALL retain the short window and clear on first content.

#### Scenario: Warm re-subscribe after reconnect shows the indicator

- **GIVEN** a reconnect has cleared the subscription set
- **WHEN** the client re-subscribes the selected session and its messages are momentarily empty
- **THEN** the loading indicator SHALL show until the replayed content arrives
- **AND** the short acknowledgement window SHALL remain the active safety-net (no empty start marker is emitted on the warm path).

#### Scenario: Cold subscribe of a large ended session does not flash empty

- **GIVEN** a user selects an ended session with substantial persisted history that is not in server memory
- **WHEN** the server emits the empty `event_replay { isLast: false }` start marker and then takes longer than the short acknowledgement window to parse and send the first content batch
- **THEN** the chat view SHALL keep showing the loading indicator throughout the parse
- **AND** the chat view SHALL NOT render "No messages yet" before the first content batch arrives.

#### Scenario: Heartbeat re-arms the ceiling on a very long parse

- **GIVEN** the hydration ceiling is armed after a cold-hydration start marker
- **WHEN** the client receives repeated empty `event_replay { isLast: false }` hydration heartbeats spaced closer together than the hydration ceiling window, before any content batch
- **THEN** each heartbeat SHALL re-arm the hydration ceiling
- **AND** the loading flag SHALL remain set for a parse that lasts longer than a single ceiling window
- **AND** the loading flag SHALL clear only after the heartbeats stop and the ceiling window elapses, or when a content / terminal / failure signal arrives.

### Requirement: Loading flag clears on failure and on timeout

The client SHALL clear the per-session loading flag when the session's history
load fails, and SHALL clear it via a safety-net timeout if no resolving signal
arrives, so the indicator can never remain stuck. The safety-net SHALL be
two-stage: a short subscribe-acknowledgement window that detects a dead link or
a server that never responded, and a longer hydration ceiling that applies once
the server has signalled that cold hydration is in progress. The short window
SHALL NOT clear the flag once the hydration ceiling is armed.

#### Scenario: Data-unavailable clears the indicator

- **GIVEN** the loading indicator is showing for a session
- **WHEN** the client receives `session_updated` with `dataUnavailable: true` for that session
- **THEN** the client SHALL clear the loading flag.

#### Scenario: Dead-link subscribe clears at the short window

- **GIVEN** the client has sent `subscribe` and armed the short acknowledgement window
- **WHEN** no `event_replay`, content, terminal `isLast`, or failure signal arrives before the short window elapses
- **THEN** the client SHALL clear the loading flag so the indicator does not persist indefinitely.

#### Scenario: Cold-hydration start marker extends the safety-net

- **GIVEN** the loading indicator is showing and the short acknowledgement window is armed
- **WHEN** the client receives an `event_replay` with zero events and `isLast: false` for that session
- **THEN** the client SHALL cancel the short acknowledgement window
- **AND** the client SHALL arm the longer hydration ceiling
- **AND** the client SHALL keep the loading flag set so a slow disk-parse does not surface the "No messages yet" placeholder.

#### Scenario: Stuck hydration clears at the ceiling

- **GIVEN** the hydration ceiling is armed after a cold-hydration start marker
- **WHEN** no content batch, terminal `isLast`, or failure signal arrives before the ceiling elapses
- **THEN** the client SHALL clear the loading flag so the indicator does not persist indefinitely.

### Requirement: No new protocol message type

The loading-indicator behavior SHALL be implemented primarily in the client by
reading the existing `event_replay.isLast` field and the existing `subscribe` /
`session_updated` messages. The only server-side addition SHALL be periodic
re-emission of the already-defined empty `event_replay { events: [], isLast: false }`
marker during cold hydration (the hydration heartbeat). No new protocol message
type and no `event_replay` wire-schema change SHALL be introduced, and the marker
SHALL remain a no-op for clients that do not implement the re-arm.

#### Scenario: Old server without heartbeats still recovers

- **GIVEN** a server that sends the single priming `event_replay { isLast: false }` but no subsequent heartbeats
- **WHEN** the client subscribes and content does not arrive
- **THEN** the client's single armed hydration ceiling SHALL clear the loading flag without any server-side change.

#### Scenario: Old client ignores hydration heartbeats

- **GIVEN** a client that does not implement the ceiling re-arm
- **WHEN** the server emits hydration heartbeats as empty `event_replay { events: [], isLast: false }` markers
- **THEN** the client SHALL treat them as no-ops (no reset of state, no false content) exactly as it treats the priming marker today.

### Requirement: Server emits hydration heartbeats during cold session load

The server SHALL periodically re-emit the empty `event_replay { events: [], isLast: false }`
marker to a session's subscriber(s) as a keepalive while it loads that session's
events from disk on the cold-subscribe path (the session is not in the in-memory
event store), so a long disk parse does not lapse the client's hydration ceiling
and surface a false empty state. The server SHALL stop emitting heartbeats as soon
as the first content batch is sent, the load fails or is cancelled, or the
subscriber is gone.

#### Scenario: Heartbeats emitted during a slow disk parse

- **GIVEN** a cold subscribe whose `loadSessionEvents` has not yet resolved
- **WHEN** a heartbeat interval elapses while the parse is still in flight
- **THEN** the server SHALL send an empty `event_replay { events: [], isLast: false }` to each live subscriber of that session.

#### Scenario: Heartbeats stop once content flows

- **GIVEN** the server has been emitting hydration heartbeats for a session
- **WHEN** the parse resolves and the server begins sending content batches (or the load fails / is cancelled / the subscriber leaves)
- **THEN** the server SHALL stop the heartbeat interval
- **AND** the server SHALL NOT send further empty non-terminal markers for that load.

#### Scenario: Heartbeat never sent to a closed socket

- **GIVEN** a subscriber whose socket has closed during hydration
- **WHEN** a heartbeat interval elapses
- **THEN** the server SHALL NOT send to the closed socket.

