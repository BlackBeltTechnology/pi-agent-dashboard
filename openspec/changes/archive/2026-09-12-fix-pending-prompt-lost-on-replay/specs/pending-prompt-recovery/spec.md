## Purpose

Guarantees that an unanswered prompt blocking an agent is always recoverable by a browser, regardless of transcript volume, socket back-pressure, or local state a replay rebuilt. Covers delivery priority for blocking frames, a requester-scoped resync against the bridge's own pending set, preservation of unanswered prompts across a client state reset, and detection of the desynced state.

## ADDED Requirements

### Requirement: Pending-prompt delivery SHALL resist transport back-pressure

The server SHALL deliver a session's tracked pending-prompt frames to a subscribed browser even while that socket's buffered amount exceeds the back-pressure threshold that governs transcript frames. The exemption SHALL be bounded twice: by a fixed maximum of 4 frames per delivery, and by an absolute buffered-amount ceiling of `MAX_WS_BUFFER` + 1 MB above which no frame is exempt. Frames beyond either bound SHALL fall back to the guarded path. Transcript, telemetry, and notify-log frames SHALL remain fully subject to the threshold.

#### Scenario: Pending prompt survives a saturated socket

- **WHEN** a browser subscribes to a session whose full replay drives the socket's buffered amount above the back-pressure threshold
- **AND** the session has an unanswered prompt tracked by the server
- **THEN** the server SHALL send the pending prompt frame to that browser
- **AND** the frame SHALL NOT be counted as a dropped frame

#### Scenario: Exemption is bounded

- **GIVEN** a saturated socket and more tracked pending prompts than the exemption maximum
- **WHEN** the server replays them
- **THEN** frames up to the maximum SHALL be delivered
- **AND** each frame beyond the maximum SHALL be dropped and counted under the blocking-frame counter

#### Scenario: Exemption stops at the absolute ceiling

- **GIVEN** a socket whose buffered amount exceeds the absolute exemption ceiling
- **WHEN** the server has a pending-prompt frame for it
- **THEN** the frame SHALL be dropped and counted under the blocking-frame counter
- **AND** repeated resync requests on that socket SHALL NOT increase its buffered amount without bound

#### Scenario: Transcript frames are still shed

- **WHEN** a socket's buffered amount exceeds the back-pressure threshold
- **AND** the server has a transcript event frame to send to it
- **THEN** the frame SHALL be dropped and counted, as before

#### Scenario: Drop counters distinguish blocking frames

- **WHEN** a blocking frame is dropped
- **THEN** the health endpoint SHALL report it under a counter distinct from transcript-frame drops

### Requirement: A browser SHALL be able to resync pending prompts on demand

The system SHALL expose a browser-initiated resync that asks the session's bridge to re-emit every prompt it is still awaiting an answer for. The bridge's own pending set SHALL be the source of truth, so a resync SHALL succeed even when the server's pending registry for that session is empty. The re-emitted prompt SHALL be delivered to the requesting browser as a blocking frame, under the same back-pressure exemption as the replay path, and SHALL NOT be fanned out to browsers that did not request it.

#### Scenario: Resync restores a prompt the server registry lost

- **GIVEN** a bridge is awaiting an answer to prompt `p1`
- **AND** the server's pending-prompt registry for that session holds no entry for `p1`
- **WHEN** a browser requests a pending-prompt resync for that session
- **THEN** the bridge SHALL re-emit `p1`
- **AND** the server SHALL track `p1` again and deliver it to the requesting browser

#### Scenario: Resync reply survives a saturated socket

- **GIVEN** a browser whose socket is saturated by an in-flight full replay
- **WHEN** that browser's resync reply is delivered
- **THEN** the reply SHALL NOT be dropped by the back-pressure guard

#### Scenario: Reply is requester-scoped

- **GIVEN** two browsers subscribed to the same session, one of which requested a resync
- **WHEN** the bridge's re-emission is routed
- **THEN** the requesting browser SHALL receive the prompt frame
- **AND** the other browser's rendered state SHALL NOT be disturbed

#### Scenario: Every prompt of a multi-prompt resync reaches the requester

- **GIVEN** a bridge awaiting answers to two or more prompts
- **WHEN** one browser requests a resync
- **THEN** every re-emitted prompt SHALL be delivered to that browser under the same exemption
- **AND** no prompt after the first SHALL be downgraded to the guarded fan-out

#### Scenario: Re-tracking survives the requester-scoped path

- **WHEN** a resync reply is delivered to its requester
- **THEN** the server SHALL have applied the same tracking and derived session state it applies to a live prompt, including the `ask_user` tool state

#### Scenario: Resync is idempotent

- **WHEN** a browser requests a resync for a session whose prompt it already renders
- **THEN** the re-emitted prompt SHALL carry the same prompt id
- **AND** the browser SHALL NOT render a duplicate dialog
- **AND** any answer already being composed SHALL be preserved

#### Scenario: Resync with nothing pending is a no-op

- **WHEN** a browser requests a resync for a session with no unanswered prompt
- **THEN** no prompt frame SHALL be sent
- **AND** no error SHALL be surfaced to the user

#### Scenario: Resync while the bridge is disconnected

- **WHEN** a browser requests a resync for a session whose bridge is not connected
- **THEN** the request SHALL be dropped without affecting the server's existing pending registry

### Requirement: Unanswered prompts SHALL survive a client state reset

When the client rebuilds a session's state — from a full event replay, from a server-signalled state reset, or from a user-initiated refresh — it SHALL preserve the session's unanswered interactive requests together with their rendered rows, in the same way it preserves an in-flight outgoing prompt. A prompt SHALL be discarded from local state only when it is answered, dismissed, or cancelled.

#### Scenario: Rendered dialog survives a full replay

- **GIVEN** a client rendering an unanswered prompt for a session
- **WHEN** a full event replay for that session rebuilds the session state
- **THEN** the prompt SHALL still be rendered after the rebuild

#### Scenario: Rendered dialog survives a server-signalled state reset

- **GIVEN** a client rendering an unanswered prompt for a session
- **WHEN** the server signals a session state reset ahead of a windowed replay
- **THEN** the prompt SHALL still be rendered after the reset

#### Scenario: Carried dialog remains interactive

- **GIVEN** a prompt carried across a state rebuild
- **WHEN** the user answers it
- **THEN** the answer SHALL be delivered for the original prompt id

#### Scenario: Resync result is not erased by a concurrent replay

- **WHEN** a resync-delivered prompt arrives while a full replay for the same session is still being applied
- **THEN** the prompt SHALL be rendered once the replay completes

#### Scenario: Answered prompts are not resurrected

- **GIVEN** a prompt that was answered or dismissed
- **WHEN** a full event replay rebuilds the session state
- **THEN** no dialog for that prompt SHALL be rendered

### Requirement: The client SHALL detect and surface a pending-prompt desync

When a session is reported as blocked on `ask_user` but the client holds no interactive request for it, the client SHALL surface a recovery affordance rather than presenting the session as merely busy. The detection SHALL be suppressed while the condition can legitimately be transient or stale: during an in-flight replay, for an ended session, and until the condition has held for a 5 second grace period.

#### Scenario: Desync surfaces a resync affordance

- **GIVEN** an active session whose reported current tool is `ask_user`
- **AND** the client holds no interactive request for that session
- **WHEN** the condition has held beyond the grace period with no replay in flight
- **THEN** the session view SHALL show an affordance indicating an answer is awaited and offering to resync

#### Scenario: Activating the affordance repairs the view

- **WHEN** the user activates the resync affordance
- **THEN** the client SHALL request a pending-prompt resync
- **AND** the dialog SHALL render once the bridge re-emits the prompt
- **AND** the affordance SHALL disappear

#### Scenario: No affordance when the dialog is rendered

- **GIVEN** a session whose reported current tool is `ask_user`
- **AND** the client renders an interactive request for that session
- **THEN** no resync affordance SHALL be shown

#### Scenario: No affordance during the normal tool-start window

- **GIVEN** a session that has just reported starting an `ask_user` tool
- **AND** the prompt frame has not yet arrived
- **THEN** no affordance SHALL be shown before the grace period elapses

#### Scenario: No affordance while a replay is in flight

- **WHEN** a full replay for the session is still being applied
- **THEN** no affordance SHALL be shown, regardless of the grace period

#### Scenario: No affordance for an ended session

- **GIVEN** an ended session whose reported current tool is still `ask_user`
- **THEN** no affordance SHALL be shown
