## ADDED Requirements

### Requirement: Emit a configured event into a session

`ServerPluginContext` SHALL expose `emitEventToSession(sessionId: string, eventType: string, data?: Record<string, unknown>): boolean`. It SHALL relay a `plugin_emit_event` control message to the target session over the bridge so the in-session bridge re-emits `eventType` with `data` on `pi.events`. It SHALL be gated to first-party / trusted plugins using the same gate as `spawnSession`/`abortSession`: an untrusted plugin SHALL receive a hook that returns `false` and sends nothing. A non-string or empty `eventType` SHALL return `false` without sending. It SHALL return `true` only when the control message is dispatched to a connected session.

The host SHALL NOT enumerate or validate `eventType` against a fixed set — a plugin emits whatever event it registered.

#### Scenario: Trusted plugin emits an event

- **WHEN** a trusted plugin calls `ctx.emitEventToSession("sess-1", "flow:run", { flowName: "test:x", task: "go" })` for a connected session
- **THEN** a `plugin_emit_event` control message carrying `eventType: "flow:run"` and the data SHALL be dispatched to that session and the call SHALL return `true`.

#### Scenario: Untrusted plugin is denied

- **WHEN** an untrusted plugin (manifest priority > 100) calls `ctx.emitEventToSession(...)`
- **THEN** the call SHALL return `false` and SHALL send nothing.

#### Scenario: Invalid event type

- **WHEN** `emitEventToSession` is called with an empty string `eventType`
- **THEN** it SHALL return `false` and SHALL send nothing.
