# chat-history-loading-indicator Specification

## Purpose
Distinguish "history loading" from "genuinely empty session" in the dashboard chat view. The client tracks a per-session loading flag, set when `subscribe` is sent and cleared when content arrives, replay completes, the load fails, or a safety-net timeout elapses, so a loading indicator (not the "No messages yet" placeholder) shows while persisted history is in flight over a remote link. Client-only; reads the existing `event_replay.isLast` field with no protocol or server change.
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

The client SHALL set the per-session loading flag at the point it sends `subscribe`, independent of whether the server later emits an empty `event_replay { isLast: false }` start marker. This ensures the indicator appears on both the cold (disk-load) path and the warm (in-memory replay / reconnect re-subscribe) path.

#### Scenario: Warm re-subscribe after reconnect shows the indicator

- **GIVEN** a reconnect has cleared the subscription set
- **WHEN** the client re-subscribes the selected session and its messages are momentarily empty
- **THEN** the loading indicator SHALL show until the replayed content arrives.

### Requirement: Loading flag clears on failure and on timeout

The client SHALL clear the per-session loading flag when the session's history load fails, and SHALL clear it via a safety-net timeout if no resolving signal arrives, so the indicator can never remain stuck.

#### Scenario: Data-unavailable clears the indicator

- **GIVEN** the loading indicator is showing for a session
- **WHEN** the client receives `session_updated` with `dataUnavailable: true` for that session
- **THEN** the client SHALL clear the loading flag.

#### Scenario: Safety-net timeout clears a stranded indicator

- **GIVEN** the loading indicator is showing for a session
- **WHEN** no content, terminal `isLast`, or failure signal arrives within the safety-net window
- **THEN** the client SHALL clear the loading flag so the indicator does not persist indefinitely.

### Requirement: No protocol or server change

The loading-indicator behavior SHALL be implemented entirely in the client by reading the existing `event_replay.isLast` field and the existing `subscribe` / `session_updated` messages. The `event_replay` wire format and server replay behavior SHALL remain unchanged.

#### Scenario: Old server without explicit markers still recovers

- **GIVEN** a server that does not send a clean terminal `event_replay { isLast: true }` on some path
- **WHEN** the client subscribes and content does not arrive
- **THEN** the safety-net timeout SHALL clear the loading flag without any server-side change.

