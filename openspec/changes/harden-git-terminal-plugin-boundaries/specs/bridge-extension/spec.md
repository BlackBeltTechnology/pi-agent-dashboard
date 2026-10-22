## MODIFIED Requirements

### Requirement: Relay plugin-emitted events into the session bus

The bridge SHALL handle a `plugin_emit_event` control message from the server: when `pi.events` is available and the message carries a non-empty string `eventType`, it SHALL call `pi.events.emit(eventType, data)` where `data` is the message's `data` object (or `{}` when absent). The bridge SHALL relay the events the server forwards and SHALL NOT keep its own event-type list; which event types a plugin may emit is decided by the server-side allowlist, which is authoritative. A missing or non-string `eventType` SHALL be ignored (no emit).

#### Scenario: Bridge re-emits a configured event

- **WHEN** the bridge receives `{ type: "plugin_emit_event", eventType: "flow:run", data: { flowName: "test:x", task: "go" } }`
- **THEN** it SHALL call `pi.events.emit("flow:run", { flowName: "test:x", task: "go" })`.

#### Scenario: Malformed emit is ignored

- **WHEN** the bridge receives `{ type: "plugin_emit_event" }` with no `eventType`
- **THEN** it SHALL emit nothing and SHALL NOT throw.

#### Scenario: Server decides which events exist

- **WHEN** the server does not forward an event type because its allowlist refuses it
- **THEN** the bridge SHALL never receive a `plugin_emit_event` for it and SHALL emit nothing
