## MODIFIED Requirements

### Requirement: Distinguish loading history from empty session

The chat view SHALL render a loading indicator while a session's persisted history is in flight, and SHALL render the empty-session placeholder only when the session is genuinely empty and the dashboard is connected. While disconnected, an empty session SHALL render the waiting-for-connection state instead of the placeholder. The client SHALL track a per-session loading flag that is set when a `subscribe` is sent and cleared when content arrives, replay completes, the load fails, or a safety-net timeout elapses.

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
- **AND** the dashboard is connected
- **WHEN** the only `event_replay` received is `{ events: [], isLast: true }`
- **THEN** the client SHALL clear the session's loading flag
- **AND** the chat view SHALL render "No messages yet".

#### Scenario: Genuinely empty session while disconnected shows waiting

- **GIVEN** a session confirmed empty by its terminal batch
- **WHEN** the dashboard connection drops
- **THEN** the chat view SHALL render "Waiting for connection" instead of "No messages yet".

### Requirement: Loading flag entry covers warm and cold subscribe paths

The client SHALL set the per-session loading flag as soon as a session with no
reduced content is selected for loading — before any asynchronous replay-cache
read that precedes `subscribe` — and SHALL (re)set it at the point it sends
`subscribe`, independent of whether the server later emits an empty
`event_replay { isLast: false }` start marker. On the cold (disk-load) path the
empty `event_replay { isLast: false }` start marker SHALL additionally re-arm the
safety-net from the short acknowledgement window to the longer hydration ceiling.
The warm (in-memory replay / reconnect re-subscribe) path, which does not emit
that empty start marker, SHALL retain the short window and clear on first content.

#### Scenario: Replay-cache read does not flash the empty placeholder

- **GIVEN** a user selects a session for the first time after a page load
- **WHEN** the client is still reading the durable replay cache and has not yet sent `subscribe`
- **THEN** the session's loading flag SHALL already be set
- **AND** the chat view SHALL NOT render "No messages yet" during the read.

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
SHALL NOT clear the flag once the hydration ceiling is armed. Whenever the flag
clears through a failure signal or a safety-net timeout while a load was in
flight and the session has no chat content, the client SHALL mark the session's
history load as **failed**. A failure signal for a session with no load in
flight SHALL NOT mark it failed. The failed mark SHALL clear when a new load
begins, when any non-empty replay batch arrives, when the terminal replay
batch arrives, or when the dashboard connection is re-established (a failure
observed while disconnected is not reported). A failed session SHALL NOT render the "No messages yet"
placeholder.

#### Scenario: Data-unavailable clears the indicator

- **GIVEN** the loading indicator is showing for a session
- **WHEN** the client receives `session_updated` with `dataUnavailable: true` for that session
- **THEN** the client SHALL clear the loading flag
- **AND** the client SHALL mark the session's history load as failed.

#### Scenario: Data-unavailable for a session not loading is not a failure

- **GIVEN** a session that has no load in flight in this tab
- **WHEN** the client receives `session_updated` with `dataUnavailable: true` for that session
- **THEN** the client SHALL NOT mark the session's history load as failed.

#### Scenario: Late terminal batch after a timeout clears the failure

- **GIVEN** a session marked failed by a safety-net timeout
- **WHEN** the terminal `event_replay { events: [], isLast: true }` for that session arrives afterwards
- **THEN** the client SHALL clear the failed mark
- **AND** the chat view SHALL render "No messages yet".

#### Scenario: Dead-link subscribe clears at the short window

- **GIVEN** the client has sent `subscribe` and armed the short acknowledgement window
- **WHEN** no `event_replay`, content, terminal `isLast`, or failure signal arrives before the short window elapses
- **THEN** the client SHALL clear the loading flag so the indicator does not persist indefinitely
- **AND** the client SHALL mark the session's history load as failed.

#### Scenario: Cold-hydration start marker extends the safety-net

- **GIVEN** the loading indicator is showing and the short acknowledgement window is armed
- **WHEN** the client receives an `event_replay` with zero events and `isLast: false` for that session
- **THEN** the client SHALL cancel the short acknowledgement window
- **AND** the client SHALL arm the longer hydration ceiling
- **AND** the client SHALL keep the loading flag set so a slow disk-parse does not surface the "No messages yet" placeholder.

#### Scenario: Stuck hydration clears at the ceiling

- **GIVEN** the hydration ceiling is armed after a cold-hydration start marker
- **WHEN** no content batch, terminal `isLast`, or failure signal arrives before the ceiling elapses
- **THEN** the client SHALL clear the loading flag so the indicator does not persist indefinitely
- **AND** the client SHALL mark the session's history load as failed.

#### Scenario: Timeout after content arrived is not a failure

- **GIVEN** a session whose first content batch has already been reduced
- **WHEN** a safety-net timeout for that session elapses
- **THEN** the client SHALL NOT mark the session's history load as failed
- **AND** the chat view SHALL keep rendering the received messages.

## ADDED Requirements

### Requirement: Chat view shows a waiting state while disconnected

When the selected session has no chat content and the dashboard's server
connection is not established, the chat view SHALL render a "Waiting for
connection" state instead of the loading skeleton, the slow-load notice, the
failed state, or the "No messages yet" placeholder. The state SHALL use a static (non-animated) icon, SHALL be exposed
as a polite status message, and SHALL be replaced by the loading skeleton once
the connection is re-established and the session is re-subscribed.

#### Scenario: Disconnected empty session shows waiting

- **GIVEN** the selected session has no messages
- **WHEN** the dashboard connection status is not connected
- **THEN** the chat view SHALL render "Waiting for connection"
- **AND** the chat view SHALL NOT render "No messages yet" or the loading skeleton.

#### Scenario: Reconnect moves waiting to loading

- **GIVEN** the chat view shows "Waiting for connection"
- **WHEN** the connection is re-established and the client re-subscribes the session
- **THEN** the chat view SHALL render the loading skeleton until content or a terminal batch arrives.

#### Scenario: Disconnect with content keeps the messages

- **GIVEN** the selected session already shows messages
- **WHEN** the connection drops
- **THEN** the chat view SHALL keep rendering the messages and SHALL NOT render the waiting state.

### Requirement: Chat view shows a slow-load notice

While the dashboard is connected and the selected session's loading flag has
been set continuously for at least 10 seconds with no chat content, the chat
view SHALL render, above the loading skeleton, a notice stating that history is
still loading together with the elapsed whole seconds and a Retry control. The
notice SHALL be announced once as a polite status message; the updating elapsed
seconds SHALL NOT trigger further announcements. The notice SHALL disappear when
content arrives, the load fails, the flag clears, or the connection drops.

#### Scenario: Notice appears after 10 seconds

- **GIVEN** the loading flag was set for the selected session 10 seconds ago and no content has arrived
- **WHEN** the chat view renders
- **THEN** it SHALL show "Still loading history" with the elapsed seconds and a Retry control above the skeleton.

#### Scenario: Elapsed seconds do not re-announce

- **GIVEN** the slow-load notice is showing
- **WHEN** the elapsed seconds advance
- **THEN** the live status text SHALL be unchanged and only the non-announced elapsed display SHALL update.

#### Scenario: Fast load never shows the notice

- **GIVEN** a session whose content arrives within 10 seconds of the flag being set
- **WHEN** the load completes
- **THEN** the slow-load notice SHALL never have been rendered.

### Requirement: Chat view shows a failed state with Retry

When the dashboard is connected, the selected session's history load is marked
failed, and the session has no chat content, the chat view SHALL render a "Couldn't load history" state
with a Retry control instead of the "No messages yet" placeholder. The state
SHALL be exposed as an alert. The icon SHALL NOT be the sole carrier of the
failure (text is always present).

#### Scenario: Timed-out load shows failed, not empty

- **GIVEN** the selected session's history load was marked failed by a safety-net timeout
- **AND** the dashboard is connected
- **WHEN** the chat view renders with no messages
- **THEN** it SHALL render "Couldn't load history" and a Retry control
- **AND** it SHALL NOT render "No messages yet".

### Requirement: Retry performs a full history re-request

Activating Retry (from the slow-load notice or the failed state) SHALL discard
the session's persisted replay-cache entry, reset its in-memory reduced state
and replay cursor, clear the failed mark, set the loading flag, and send
`subscribe` with `lastSeq: 0`. Pending interactive requests carried across other
reset paths SHALL be carried across this reset too.

#### Scenario: Retry re-subscribes from zero

- **GIVEN** the chat view shows "Couldn't load history" for a session
- **WHEN** the user activates Retry
- **THEN** the client SHALL drop the session's persisted replay-cache entry
- **AND** the client SHALL send `subscribe` for that session with `lastSeq: 0`
- **AND** the chat view SHALL render the loading skeleton.

#### Scenario: Retry from the slow notice restarts the elapsed count

- **GIVEN** the slow-load notice shows 14 elapsed seconds (loading flag still set)
- **WHEN** the user activates Retry
- **THEN** the elapsed count SHALL restart from zero for the new load
- **AND** the notice SHALL disappear until 10 seconds of the new load have elapsed.
