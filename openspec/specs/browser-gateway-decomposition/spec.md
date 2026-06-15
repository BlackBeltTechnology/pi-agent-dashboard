## ADDED Requirements

### Requirement: Subscription handler extraction
browser-gateway.ts SHALL delegate `subscribe` and `unsubscribe` message handling (including event replay and lazy session loading) to a subscription handler module.

#### Scenario: Subscribe replays events from memory
- **WHEN** a browser subscribes to a session with events in memory
- **THEN** the subscription handler replays events in batches and sends pending UI requests

#### Scenario: Subscribe lazy-loads ended sessions
- **WHEN** a browser subscribes to an ended session not in memory
- **THEN** the subscription handler loads events from disk via DirectoryService and broadcasts them

#### Scenario: Subscribe with lastSeq returns delta
- **WHEN** a browser subscribes with `lastSeq: 50` and the server has events up to seq 100
- **THEN** the subscription handler SHALL replay only events with seq 51–100

#### Scenario: Subscribe with stale lastSeq triggers reset
- **WHEN** a browser subscribes with `lastSeq: 500` but server max seq is 10
- **THEN** the subscription handler SHALL send `session_state_reset` to the subscribing WebSocket and replay all events from seq 1

### Requirement: Session action handler extraction
browser-gateway.ts SHALL delegate action messages (`send_prompt`, `abort`, `resume_session`, `spawn_session`, `shutdown`, `flow_control`) to a session action handler module.

#### Scenario: Send prompt forwards to pi gateway
- **WHEN** browser sends a send_prompt for an active session
- **THEN** the session action handler forwards to piGateway

#### Scenario: Send prompt to ended session triggers auto-resume
- **WHEN** browser sends a send_prompt for an ended session
- **THEN** the session action handler queues the prompt and spawns a pi process to continue

### Requirement: Session meta handler extraction
browser-gateway.ts SHALL delegate metadata messages (`rename_session`, `hide_session`, `unhide_session`, `attach_proposal`, `detach_proposal`, `fetch_content`, `list_sessions`) to a session meta handler module.

#### Scenario: Rename broadcasts update
- **WHEN** browser sends rename_session
- **THEN** the meta handler updates session manager, broadcasts to all browsers, and forwards to extension

### Requirement: Terminal handler extraction
browser-gateway.ts SHALL delegate terminal messages (`create_terminal`, `kill_terminal`, `rename_terminal`) to a terminal handler module.

#### Scenario: Create terminal spawns and broadcasts
- **WHEN** browser sends create_terminal
- **THEN** the terminal handler spawns a PTY, inserts into session order, and broadcasts terminal_added

### Requirement: Directory handler extraction
browser-gateway.ts SHALL delegate directory/preference messages (`pin_directory`, `unpin_directory`, `reorder_pinned_dirs`, `reorder_sessions`, `openspec_refresh`, `openspec_bulk_archive`, `extension_ui_response`, `request_commands`, `list_files`, `request_models`, `set_model`, `set_thinking_level`) to a directory handler module.

#### Scenario: Pin directory triggers discovery
- **WHEN** browser sends pin_directory
- **THEN** the directory handler resolves the path, persists the pin, triggers session discovery, and broadcasts the update

### Requirement: Lazy session subscription
The browser client SHALL NOT auto-subscribe to all active sessions on connect. Instead, it SHALL subscribe only to the currently selected/viewed session. Sidebar session cards SHALL rely on `session_added` and `session_updated` broadcasts for metadata display.

#### Scenario: Browser connects with no session selected
- **WHEN** a browser client connects and no session is selected
- **THEN** the client SHALL NOT send any `subscribe` messages
- **AND** the sidebar SHALL display session cards using metadata from `session_added` messages

#### Scenario: User selects a session
- **WHEN** the user navigates to session "s1"
- **THEN** the client SHALL send `subscribe { sessionId: "s1", lastSeq: <maxSeq or 0> }`

#### Scenario: Browser reconnects with session selected
- **WHEN** the browser WebSocket reconnects and session "s1" was selected
- **THEN** the client SHALL re-subscribe to "s1" with `lastSeq` from its seq tracker
- **AND** the client SHALL NOT subscribe to other active sessions

#### Scenario: session_added for active session does not trigger subscribe
- **WHEN** the browser receives `session_added` for a new active session
- **THEN** the client SHALL NOT auto-subscribe to that session
- **AND** the sidebar card SHALL display using the session metadata from the message

### Requirement: Handler exceptions are logged, not silently swallowed

The browser-gateway WebSocket message dispatcher SHALL distinguish between two failure modes:

1. A frame that is not valid JSON (malformed input). This MAY be silently dropped.
2. An exception thrown by an individual message handler while processing a parsed message. This SHALL be caught and logged with enough context to diagnose the failure. It SHALL NOT be silently swallowed.

The catch-all around the message-type `switch` that previously absorbed all exceptions SHALL be scoped so that only `JSON.parse` errors produce no log output. Handler exceptions SHALL emit a log line that includes the message type and the underlying error.

#### Scenario: Malformed JSON frame is silently dropped
- **WHEN** a browser WebSocket client sends a frame whose payload is not valid JSON
- **THEN** the dispatcher SHALL NOT throw
- **AND** the dispatcher SHALL NOT emit a handler-error log line

#### Scenario: Handler throws an exception during dispatch
- **WHEN** a browser WebSocket client sends a well-formed message of type `<T>`
- **AND** the handler for type `<T>` throws an error `E`
- **THEN** the dispatcher SHALL log an error line that includes the literal string `[browser-gw] handler error`, the message type `<T>`, and the error `E`
- **AND** the dispatcher SHALL remain running and continue to accept subsequent messages

#### Scenario: create_terminal handler throws because node-pty fails to spawn
- **WHEN** a browser sends `{ type: "create_terminal", cwd: "..." }`
- **AND** `terminalManager.spawn` throws (e.g. `posix_spawnp failed.`)
- **THEN** the dispatcher SHALL log an error containing `[browser-gw] handler error`, `type=create_terminal`, and the underlying error text
- **AND** the WebSocket connection SHALL remain open

## ADDED Requirements

### Requirement: On-connect snapshot replaces per-session loop

On every browser WebSocket connect, the browser gateway SHALL emit exactly one `sessions_snapshot` message containing all sessions and all non-empty per-cwd session orders. It SHALL NOT emit per-session `session_added` messages or per-cwd `sessions_reordered` messages as part of the on-connect bootstrap.

Live updates after the snapshot SHALL continue to use the existing incremental `session_added`, `session_updated`, `session_removed`, and `sessions_reordered` messages.

#### Scenario: Single snapshot per connection
- **WHEN** a new browser WebSocket connection is established
- **THEN** the gateway SHALL send exactly one message of type `sessions_snapshot` to that socket before any other session-registry-related send
- **AND** the gateway SHALL NOT iterate `sessionManager.listAll()` to send per-session `session_added` for that bootstrap
- **AND** the gateway SHALL NOT iterate `sessionOrderManager.getAllOrders()` to send per-cwd `sessions_reordered` for that bootstrap

#### Scenario: Live update after snapshot uses incremental message
- **WHEN** a bridge registers a new session after the snapshot has been sent on that connection
- **THEN** the gateway SHALL emit the incremental `session_added` for that session as before, NOT another snapshot

#### Scenario: Other on-connect sends preserved
- **WHEN** the gateway sends the snapshot on connect
- **THEN** existing on-connect sends for `pinned_dirs_updated`, `openspec_update`, and `terminal_added` SHALL be preserved unchanged

### Requirement: Broadcast serializes payload once per fan-out

When broadcasting a message to all subscribed browser sockets, the gateway SHALL serialize the payload **exactly once** per `broadcast()` call and send the same serialized frame to every open socket, rather than re-serializing per recipient. This bounds per-broadcast CPU at O(payload) instead of O(payload × subscribers), which matters for large recurring payloads such as `openspec_update` for repositories with many changes.

Existing back-pressure and liveness guards SHALL be preserved: a socket whose `readyState` is not `OPEN` SHALL be skipped, and a socket whose `bufferedAmount` exceeds `MAX_WS_BUFFER` (when the limit is non-zero) SHALL be skipped.

#### Scenario: Single serialization regardless of subscriber count
- **WHEN** `broadcast(msg)` is called with three subscribed open sockets
- **THEN** the payload SHALL be serialized once
- **AND** each of the three sockets SHALL receive an identical frame

#### Scenario: Back-pressure drop still applies after serialize-once
- **WHEN** one subscribed socket has `bufferedAmount` greater than `MAX_WS_BUFFER` and `MAX_WS_BUFFER` is non-zero
- **THEN** that socket SHALL NOT receive the frame
- **AND** the other open sockets SHALL still receive the single serialized frame

#### Scenario: Closed socket skipped
- **WHEN** a subscribed socket's `readyState` is not `OPEN`
- **THEN** that socket SHALL be skipped without error and the remaining open sockets SHALL receive the frame
