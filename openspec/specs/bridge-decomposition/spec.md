# bridge-decomposition Specification

## Purpose

Splits the bridge extension's monolithic entry point into focused modules — session sync, model tracking, and flow event wiring — each with a defined boundary. Exists so the extension that runs inside every pi session stays reviewable and each concern can be tested without booting the whole bridge.

## Requirements

### Requirement: Session sync extraction
bridge.ts SHALL delegate `sendStateSync()`, `replaySessionEntries()`, and `handleSessionChange()` to a `session-sync` module.

#### Scenario: State sync on reconnect
- **WHEN** the WebSocket connection reconnects
- **THEN** session-sync sends session_register, commands_list, flows_list, and models_list messages

#### Scenario: Session entries replayed
- **WHEN** state sync or session change occurs
- **THEN** session-sync replays all session entries as protocol events

### Requirement: Model tracker extraction
bridge.ts SHALL delegate model/thinking-level change detection and update sending to a `model-tracker` module.

#### Scenario: Model change detected and sent
- **WHEN** the current model or thinking level changes
- **THEN** model-tracker sends a model_update message to the server

#### Scenario: No update when unchanged
- **WHEN** model and thinking level are the same as last sent
- **THEN** model-tracker does not send a message

### Requirement: Flow event wiring extraction
bridge.ts SHALL delegate flow event listener registration (mapping `flow:*` pi events to `event_forward` protocol messages) to a `flow-event-wiring` module.

#### Scenario: Flow events forwarded as protocol messages
- **WHEN** a flow event fires (flow:flow-started, flow:agent-started, flow:complete, etc.)
- **THEN** flow-event-wiring sends an event_forward message with the mapped eventType and event data

#### Scenario: Commands and flows re-sent on flow lifecycle
- **WHEN** flow:rediscover or flow:complete fires
- **THEN** flow-event-wiring triggers re-sending of commands_list and flows_list
