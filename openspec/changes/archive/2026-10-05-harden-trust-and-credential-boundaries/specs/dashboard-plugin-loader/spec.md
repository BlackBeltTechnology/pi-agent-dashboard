## MODIFIED Requirements

### Requirement: Emit a configured event into a session

`ServerPluginContext` SHALL expose `emitEventToSession(sessionId: string, eventType: string, data?: Record<string, unknown>): boolean`. It SHALL relay a `plugin_emit_event` control message to the target session over the bridge so the in-session bridge re-emits `eventType` with `data` on `pi.events`. It SHALL be gated to first-party / trusted plugins using the same gate as `spawnSession`/`abortSession`: an untrusted plugin SHALL receive a hook that returns `false` and sends nothing. A non-string or empty `eventType` SHALL return `false` without sending. It SHALL return `true` only when the control message is dispatched to a connected session.

The host SHALL NOT enumerate `eventType` against a fixed allowlist — a plugin emits whatever event it registered — EXCEPT that it SHALL refuse (return `false`, send nothing, log one warning) any `eventType` beginning with a reserved prefix: `roles:`, `role:`, `model:`, `prompt:`, `dashboard:`, `ui:`. Those namespaces carry pi-agent-dashboard's own in-session control listeners (role/provider config writes, follow-up prompt injection, prompt adapters, model resolution, UI invalidation) and SHALL NOT be reachable through plugin emission. The raw `sendExtensionMessage` lane SHALL refuse (return `false`) any message whose `type` is `plugin_emit_event`, so the reserved-prefix check cannot be bypassed.

#### Scenario: Trusted plugin emits an event

- **WHEN** a trusted plugin calls `ctx.emitEventToSession("sess-1", "flow:run", { flowName: "test:x", task: "go" })` for a connected session
- **THEN** a `plugin_emit_event` control message carrying `eventType: "flow:run"` and the data SHALL be dispatched to that session and the call SHALL return `true`.

#### Scenario: Untrusted plugin is denied

- **WHEN** an untrusted plugin (manifest priority > 100) calls `ctx.emitEventToSession(...)`
- **THEN** the call SHALL return `false` and SHALL send nothing.

#### Scenario: Invalid event type

- **WHEN** `emitEventToSession` is called with an empty string `eventType`
- **THEN** it SHALL return `false` and SHALL send nothing.

#### Scenario: Reserved-namespace event refused

- **WHEN** a trusted plugin calls `ctx.emitEventToSession("sess-1", "roles:set", {...})` or `ctx.emitEventToSession("sess-1", "dashboard:enqueue-followup", {...})`
- **THEN** the call SHALL return `false` and SHALL send nothing.

#### Scenario: Raw lane cannot smuggle an event emission

- **WHEN** a trusted plugin calls `ctx.sendExtensionMessage("sess-1", { type: "plugin_emit_event", eventType: "roles:set", data: {} })`
- **THEN** the call SHALL return `false` and SHALL send nothing.
