# chat-history-loading-indicator Delta Specification

## MODIFIED Requirements

### Requirement: Distinguish loading history from empty session

The chat view SHALL render a loading indicator while a session's persisted history is in flight, and SHALL render the empty-session placeholder only when the session is genuinely empty. The client SHALL track a per-session loading flag that is set when a `subscribe` is sent and cleared when content arrives, replay completes, the load fails, or a safety-net timeout elapses.

The full-screen loading indicator applies only to the initial load (tail window in flight). Older-history pagination (`load_older`, see `chat-history-pagination`) SHALL NOT set the per-session loading flag and SHALL NOT render the full-screen skeleton; it renders a slim top-of-transcript loading row instead.

#### Scenario: Loading indicator during history transfer

- **GIVEN** a user opens an old/ended session whose history has not yet arrived
- **WHEN** the client has sent `subscribe` and `state.messages` is still empty
- **THEN** the chat view SHALL render a loading indicator
- **AND** the chat view SHALL NOT render the "No messages yet" placeholder.

#### Scenario: Content replaces the indicator on tail arrival

- **GIVEN** the loading indicator is showing for a session
- **WHEN** the first non-empty `event_replay` batch (`kind: "tail"`) is reduced into `state.messages`
- **THEN** the client SHALL clear the session's loading flag
- **AND** the chat view SHALL render the message bubbles.

#### Scenario: Genuinely empty session shows the placeholder

- **GIVEN** a session with no persisted history
- **WHEN** the only `event_replay` received is `{ events: [], isLast: true }`
- **THEN** the client SHALL clear the session's loading flag
- **AND** the chat view SHALL render "No messages yet".

#### Scenario: Older-page fetch does not trigger the full-screen indicator

- **GIVEN** a session whose tail window is already rendered
- **WHEN** the client sends `load_older` and awaits the response
- **THEN** the per-session loading flag SHALL remain false
- **AND** the full-screen skeleton SHALL NOT render (the slim top row covers the pagination feedback).
