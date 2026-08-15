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

### Requirement: Replay-in-flight is tracked to the terminal batch

The client SHALL track a per-session replay-in-flight flag that is distinct from
the history-loading flag. The replay-in-flight flag SHALL be set when a
`subscribe` is sent for a session, and SHALL be cleared ONLY when the terminal
`event_replay { isLast: true }` for that session is received, when the session's
load fails, or when a safety-net timeout elapses. Arrival of a non-terminal
`event_replay` batch — including the first batch carrying content — SHALL NOT
clear the replay-in-flight flag.

#### Scenario: First content batch does not clear the flag

- **GIVEN** the client has sent `subscribe` for a session and the replay-in-flight flag is set
- **WHEN** the client receives an `event_replay` with one or more events and `isLast: false`
- **THEN** the replay-in-flight flag SHALL remain set
- **AND** the client SHALL reduce that batch's events into `state.messages` as it does today.

#### Scenario: Terminal batch clears the flag

- **GIVEN** the replay-in-flight flag is set for a session
- **WHEN** the client receives an `event_replay` with `isLast: true` for that session
- **THEN** the client SHALL clear the replay-in-flight flag.

#### Scenario: Empty session clears the flag on its terminal batch

- **GIVEN** a session with no persisted history
- **WHEN** the only `event_replay` received is `{ events: [], isLast: true }`
- **THEN** the client SHALL clear the replay-in-flight flag.

#### Scenario: The two flags diverge on the same message sequence

- **GIVEN** the client has sent `subscribe` for a session with multi-batch history
- **WHEN** the first `event_replay` batch with content and `isLast: false` is received
- **THEN** the history-loading flag SHALL be cleared
- **AND** the replay-in-flight flag SHALL remain set
- **AND** the replay-in-flight flag SHALL clear only on the later `isLast: true` batch.

### Requirement: Every subscribe terminates in a terminal batch

The server SHALL send exactly one terminal `event_replay { isLast: true }` for
every `subscribe` it accepts, including when it has no events to send. A replay
payload containing zero events SHALL NOT be answered with silence.

#### Scenario: Empty warm delta still terminates

- **GIVEN** a warm subscribe carrying a `lastSeq` equal to the session's current high-water mark, so the computed delta is empty
- **WHEN** the server sends the replay for that subscribe
- **THEN** the server SHALL send one `event_replay { events: [], isLast: true }`.

#### Scenario: Cold load of an empty session terminates

- **GIVEN** a cold subscribe for a session whose persisted history contains zero events
- **WHEN** the load succeeds
- **THEN** the server SHALL send one `event_replay { events: [], isLast: true }`.

#### Scenario: Non-empty replay is unchanged

- **GIVEN** a subscribe whose replay payload contains one or more events
- **WHEN** the server batches it
- **THEN** the batch sequence SHALL be unchanged from today, with `isLast: true` on the final batch only
- **AND** no additional terminal batch SHALL be sent.

### Requirement: Chat view indicates an unfinished replay

The chat view SHALL render an indeterminate in-flight indicator while the
selected session's replay-in-flight flag is set, so a partially replayed session
is never presented as complete. The indicator SHALL be anchored to the bottom of
the message list, visually where the not-yet-delivered events will land, and
SHALL overlay rather than occupy list space so it cannot displace or reflow the
rendered messages. The indicator SHALL NOT be implemented by reserving space in
the list — for example as trailing padding — because that reflows the virtualized
transcript and perturbs scroll anchoring. The indicator SHALL NOT express a count, a total, or a
percentage. The indicator and the history-loading skeleton SHALL NOT render at
the same time.

The indicator SHALL be composed of a decorative scrim pinned to the bottom edge
of the message list, fading into the transcript, and a label anchored above the
chat view's scroll controls. The scrim SHALL be presentational only: it SHALL
carry `aria-hidden="true"` so one status contributes one node to the
accessibility tree, and it SHALL NOT intercept pointer events, so text selection
and clicks over the transcript beneath it behave exactly as when it is absent.
The scrim and the label SHALL appear and disappear together, so the transcript
can never be left dimmed by a scrim whose label has cleared.

The indicator SHALL NOT occlude, overlap, or otherwise obstruct any other
interactive control rendered in the chat view, at any supported viewport width.
The positions of the indicator and the scroll controls SHALL be separated by
layout rather than by paint order. The scroll controls' resting position SHALL
NOT depend on whether a replay is in flight, so that no control changes position
when a replay begins or ends.

The indicator's visual boundary against the transcript background SHALL meet a
contrast ratio of at least 3:1, in both the dark and light themes, satisfying
WCAG 2.1 SC 1.4.11 Non-text Contrast. A drop shadow SHALL NOT be relied on as
the sole means of separating the indicator from the transcript, because it
carries no contrast over a near-black background.

The indicator SHALL suppress its animation when the user agent reports
`prefers-reduced-motion: reduce`. The indicator SHALL remain visible in that
state, so the status is conveyed without motion.

The indicator SHALL carry `data-testid="replay-in-flight-pill"`, `role="status"`,
and `aria-busy="true"`, mirroring the history-loading skeleton's contract. Its
accessible name SHALL be derived from its visible text content; a redundant
`aria-label` duplicating that text SHALL NOT be set.

#### Scenario: Indicator exposes a stable test and accessibility handle

- **GIVEN** the in-flight indicator is rendered
- **WHEN** the chat view is queried
- **THEN** the indicator SHALL be reachable by `data-testid="replay-in-flight-pill"`
- **AND** it SHALL expose `role="status"`, `aria-busy="true"`, and a non-empty accessible name.

#### Scenario: Indicator never obstructs the scroll-to-bottom control

- **GIVEN** a session whose replay-in-flight flag is set and whose scroll-to-bottom control is rendered
- **WHEN** the chat view is rendered at a narrow viewport width of 375 CSS pixels
- **THEN** the indicator's bounding box SHALL NOT intersect the scroll-to-bottom control's bounding box
- **AND** the scroll-to-bottom control SHALL remain clickable for the whole time the indicator is showing.

#### Scenario: Scroll controls do not move when a replay starts or ends

- **GIVEN** a session whose scroll-to-bottom control is rendered and whose replay-in-flight flag is clear
- **WHEN** the flag is set, the indicator appears, and the flag is later cleared
- **THEN** the scroll-to-bottom control SHALL occupy the same position throughout.

#### Scenario: The scrim does not capture pointer input

- **GIVEN** the indicator is rendered over the tail of the transcript
- **WHEN** the user selects or clicks the message text beneath the scrim
- **THEN** the interaction SHALL reach the message content
- **AND** the scrim SHALL NOT be the event target.

#### Scenario: Scrim and label clear together

- **GIVEN** the indicator is showing for a session
- **WHEN** the replay-in-flight flag clears
- **THEN** the chat view SHALL stop rendering the label
- **AND** the chat view SHALL stop rendering the scrim.

#### Scenario: Indicator boundary is perceivable in both themes

- **GIVEN** the in-flight indicator is rendered over the message transcript
- **WHEN** its background and border are measured against the transcript background
- **THEN** the contrast ratio SHALL be at least 3:1 in the dark theme
- **AND** the contrast ratio SHALL be at least 3:1 in the light theme.

#### Scenario: Indicator honours reduced motion

- **GIVEN** the user agent reports `prefers-reduced-motion: reduce`
- **WHEN** the in-flight indicator is rendered
- **THEN** the indicator SHALL NOT animate
- **AND** the indicator SHALL still be rendered and still expose `role="status"` and `aria-busy="true"`.

#### Scenario: Indicator shows between the first and last batch

- **GIVEN** a session whose first `event_replay` batch has been rendered and whose replay-in-flight flag is set
- **WHEN** the chat view renders
- **THEN** the chat view SHALL render the in-flight indicator at the end of the message list.

#### Scenario: Indicator disappears on replay completion

- **GIVEN** the in-flight indicator is showing for a session
- **WHEN** the terminal `event_replay { isLast: true }` is received
- **THEN** the chat view SHALL stop rendering the in-flight indicator.

#### Scenario: Indicator is independent of the empty-session placeholder

- **GIVEN** a session with no persisted history
- **WHEN** the only `event_replay` received is `{ events: [], isLast: true }`
- **THEN** the chat view SHALL render "No messages yet"
- **AND** the chat view SHALL NOT render the in-flight indicator.

#### Scenario: Indicator does not double up with the loading skeleton

- **GIVEN** a cold session whose replay-in-flight flag is set, whose history-loading flag is still set, and whose message list is still empty
- **WHEN** the delay threshold elapses before the first content batch arrives
- **THEN** the chat view SHALL render the history-loading skeleton
- **AND** the chat view SHALL NOT render the in-flight indicator
- **AND** once the first content batch renders, the skeleton SHALL be replaced by the in-flight indicator.

### Requirement: In-flight indicator is suppressed for fast replays

The client SHALL delay rendering the in-flight indicator by a fixed threshold
after the replay-in-flight flag is set, and SHALL render it only if the flag is
still set once that threshold elapses. A replay that completes within the
threshold SHALL produce no visible indicator at any point, so the warm
(cache-hit / small-delta) path does not flicker. The threshold SHALL be a single
named constant and SHALL NOT be conditioned on replay-cache state.

#### Scenario: Fast replay never paints the indicator

- **GIVEN** the client has sent `subscribe` and the replay-in-flight flag is set
- **WHEN** the terminal `event_replay { isLast: true }` arrives before the delay threshold elapses
- **THEN** the chat view SHALL never have rendered the in-flight indicator.

#### Scenario: The pending delay is cancelled when the flag clears

- **GIVEN** the client has sent `subscribe`, the replay-in-flight flag is set, and the delay timer is pending
- **WHEN** the flag clears before the threshold elapses, and the threshold instant is then passed
- **THEN** the chat view SHALL NOT render the in-flight indicator at or after that instant
- **AND** no pending delay timer SHALL remain armed for that session.

#### Scenario: Delay state does not leak across a session switch

- **GIVEN** the in-flight indicator is showing for session A, or its delay timer is pending for session A
- **WHEN** the user switches the chat view to session B, whose replay is not in flight
- **THEN** the chat view SHALL NOT render the in-flight indicator for session B
- **AND** no delay timer armed for session A SHALL cause the indicator to appear for session B.

#### Scenario: Slow replay paints the indicator once the threshold elapses

- **GIVEN** the client has sent `subscribe` and the replay-in-flight flag is set
- **WHEN** the delay threshold elapses with the flag still set
- **THEN** the chat view SHALL render the in-flight indicator
- **AND** the indicator SHALL remain until the flag is cleared.

#### Scenario: Suppression is not conditioned on the replay cache

- **GIVEN** two sessions whose replays both complete within the delay threshold, one served from a warm replay-cache rehydrate and one from a cold full replay
- **WHEN** each session's replay completes
- **THEN** neither SHALL have rendered the in-flight indicator.

### Requirement: Replay-in-flight flag can never stick

The replay-in-flight flag SHALL be protected by the same two-stage safety net as
the history-loading flag: a short subscribe-acknowledgement window armed when
`subscribe` is sent, re-armed to the longer hydration ceiling. The flag SHALL be
cleared when the session's history load fails and when the active safety-net
window elapses, so a lost or never-sent terminal batch cannot leave the indicator
showing indefinitely. Clearing SHALL be one-way: once a safety-net window has
elapsed, a later non-terminal batch SHALL NOT re-set the flag.

#### Scenario: Lost terminal batch clears at the ceiling

- **GIVEN** the replay-in-flight flag is set and the safety-net window is armed
- **WHEN** no terminal `event_replay { isLast: true }`, failure signal, or further heartbeat arrives before the armed window elapses
- **THEN** the client SHALL clear the replay-in-flight flag
- **AND** the chat view SHALL stop rendering the in-flight indicator.

#### Scenario: Data-unavailable clears the flag

- **GIVEN** the replay-in-flight flag is set for a session
- **WHEN** the client receives `session_updated` with `dataUnavailable: true` for that session
- **THEN** the client SHALL clear the replay-in-flight flag.

#### Scenario: Heartbeats extend the window without clearing the flag

- **GIVEN** the replay-in-flight flag is set and the hydration ceiling is armed
- **WHEN** the client receives repeated empty `event_replay { events: [], isLast: false }` hydration heartbeats spaced closer together than the ceiling window
- **THEN** each heartbeat SHALL re-arm the ceiling
- **AND** the replay-in-flight flag SHALL remain set.

### Requirement: The flag survives for as long as replay is in flight

Every non-terminal `event_replay` for a session — carrying content or empty —
SHALL re-arm that session's replay-in-flight safety-net window, because a batch
on the wire is evidence the replay is still live. The flag SHALL NOT be cleared
by a safety-net window that elapsed while batches were still arriving.

#### Scenario: Content batches re-arm the ceiling

- **GIVEN** the replay-in-flight flag is set for a multi-batch session
- **WHEN** non-terminal content batches arrive spaced closer together than the ceiling window, over a total span longer than the ceiling window
- **THEN** the replay-in-flight flag SHALL still be set when the final batch arrives
- **AND** the chat view SHALL still be rendering the in-flight indicator throughout.

#### Scenario: A slow transfer does not clear the flag mid-replay

- **GIVEN** the replay-in-flight flag is set and the first content batch has been received
- **WHEN** the next batch is delayed by backpressure for longer than the short subscribe-acknowledgement window but less than the ceiling window
- **THEN** the replay-in-flight flag SHALL remain set
- **AND** the chat view SHALL NOT present the partially replayed session as complete.

#### Scenario: A silent wire still clears at the ceiling

- **GIVEN** the replay-in-flight flag is set and a non-terminal batch has just re-armed the ceiling
- **WHEN** no further message of any kind arrives before the ceiling window elapses
- **THEN** the client SHALL clear the replay-in-flight flag.

#### Scenario: A batch resuming after the ceiling does not revive the flag

- **GIVEN** the replay-in-flight flag was cleared because its ceiling window elapsed
- **WHEN** a further non-terminal `event_replay` batch for that session arrives
- **THEN** the replay-in-flight flag SHALL remain clear
- **AND** the chat view SHALL NOT render the in-flight indicator.

### Requirement: No wire-schema change for the in-flight indicator

The replay-in-flight behavior SHALL read only the existing `event_replay.isLast`
field and the existing `subscribe` / `session_updated` messages. No new protocol
message type and no new or changed `event_replay` field SHALL be introduced. The
only server-side change SHALL be emitting the already-defined terminal batch on
the empty-payload path.

#### Scenario: Multi-batch indicator needs no server change

- **GIVEN** a server with no changes to its batching, backpressure, or heartbeat behavior
- **WHEN** a client implementing the in-flight indicator subscribes to a multi-batch session
- **THEN** the indicator SHALL appear and clear correctly from the existing message stream alone.

#### Scenario: Old client handles the terminal batch without new code

- **GIVEN** a client that does not implement the replay-in-flight flag, talking to a server that terminates empty replays
- **WHEN** it subscribes to a session with an empty replay payload and receives `event_replay { events: [], isLast: true }`
- **THEN** it SHALL clear its history-loading flag and render "No messages yet" through its existing `isLast` handling
- **AND** it SHALL render that placeholder sooner than it does today, where the empty path produces no terminal batch and the loading skeleton persists until the hydration ceiling elapses
- **AND** no new message type SHALL require handling.

#### Scenario: New client against an old server degrades safely

- **GIVEN** a client implementing the replay-in-flight flag, talking to a server that does not terminate empty replays
- **WHEN** it subscribes to a session with an empty replay payload
- **THEN** the replay-in-flight flag SHALL be cleared by the safety-net window
- **AND** the client SHALL NOT hang in a permanently in-flight state.

