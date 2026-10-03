## MODIFIED Requirements

### Requirement: Control events handled specially and not forwarded as event_forward
The following pi core events have dedicated handlers in the bridge that produce their own protocol messages (e.g., `session_register`, disconnect). They SHALL NOT be forwarded as `event_forward` messages to avoid redundant data:

- `session_start` — triggers session registration (`session_register` protocol message), context caching, model/git info sync, and flow event wiring. Produces its own protocol flow.
- `session_switch` — updates the bridge's `sessionId` and sends a new `session_register`. The old session is implicitly replaced.
- `session_fork` — same as `session_switch`: updates `sessionId`, sends `session_register`.
- `session_shutdown` — triggers WebSocket disconnect and cleanup. No `event_forward` needed; the server detects disconnection via the WebSocket close.
- `cache_warming_decision` — a usage drain point: the handler forwards newly recorded entry usage as `usage_recorded` messages (see `token-stats-pipeline`) and returns no decision override.

These events are fully handled by their dedicated `pi.on()` callbacks and are excluded from both the enriched and pass-through subscription lists.

#### Scenario: session_start not forwarded as event_forward
- **WHEN** a `session_start` event fires
- **THEN** the bridge SHALL handle it via its dedicated callback (session registration) and SHALL NOT send an `event_forward` message

#### Scenario: session_shutdown not forwarded as event_forward
- **WHEN** a `session_shutdown` event fires
- **THEN** the bridge SHALL handle it via its dedicated callback (disconnect/cleanup) and SHALL NOT send an `event_forward` message

#### Scenario: cache_warming_decision not forwarded as event_forward
- **WHEN** a `cache_warming_decision` event fires
- **THEN** the bridge SHALL drain entry usage via its dedicated callback and SHALL NOT send an `event_forward` message
