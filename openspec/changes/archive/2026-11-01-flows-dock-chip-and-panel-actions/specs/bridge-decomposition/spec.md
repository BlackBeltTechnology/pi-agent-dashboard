## MODIFIED Requirements

### Requirement: Session sync extraction
The bridge extension SHALL delegate `sendStateSync()`, `replaySessionEntries()`, and `handleSessionChange()` to a `session-sync` module.

#### Scenario: State sync on reconnect
- **WHEN** the WebSocket connection reconnects
- **THEN** session-sync sends session_register, commands_list, and models_list messages
- **AND** it SHALL NOT send a flow list

#### Scenario: Session entries replayed
- **WHEN** state sync or session change occurs
- **THEN** session-sync replays all session entries as protocol events

### Requirement: Flow event wiring extraction
bridge.ts SHALL delegate flow event listener registration (mapping `flow:*` pi events to `event_forward` protocol messages) to a `flow-event-wiring` module.

#### Scenario: Flow events forwarded as protocol messages
- **WHEN** a flow event fires (flow:flow-started, flow:agent-started, flow:complete, etc.)
- **THEN** flow-event-wiring sends an event_forward message with the mapped eventType and event data

#### Scenario: Commands and flows re-sent on flow lifecycle
- **WHEN** flow:rediscover or flow:complete fires
- **THEN** flow-event-wiring triggers re-sending of commands_list only
