## ADDED Requirements

### Requirement: session_register registerReason field
The `session_register` extension-to-server protocol message SHALL include an optional `registerReason: "spawn" | "reattach"` field. The bridge SHALL set this field to:

- **`"spawn"`** for the very first `session_register` after the bridge process boots, and for every `session_register` emitted by `handleSessionChange` (the new/fork/resume path that mints a fresh `sessionId`).
- **`"reattach"`** for every subsequent `sendStateSync` invocation triggered by a WebSocket reconnect to the dashboard server (i.e. the dashboard restarted while the bridge process kept running).

The bridge SHALL track this via a `hasRegisteredOnce` boolean on `BridgeContext`. The flag SHALL flip from `false` to `true` exactly once per bridge process — on the first `sendStateSync` call after process boot — and SHALL remain `true` for the rest of the process lifetime regardless of session-change events.

When the field is absent (legacy bridge), the server SHALL treat the message as if `registerReason: "spawn"` was specified, preserving pre-existing behavior.

#### Scenario: First sendStateSync after boot tags spawn
- **WHEN** a fresh bridge process connects to the dashboard for the first time and `sendStateSync` runs
- **THEN** the emitted `session_register` SHALL include `registerReason: "spawn"`
- **AND** `BridgeContext.hasRegisteredOnce` SHALL be `true` after the call

#### Scenario: Reconnect after dashboard restart tags reattach
- **WHEN** the dashboard server has restarted and the bridge's WebSocket reconnects, triggering a second `sendStateSync` for the same bridge process
- **THEN** the emitted `session_register` SHALL include `registerReason: "reattach"`

#### Scenario: handleSessionChange always tags spawn
- **WHEN** the user creates a new pi session, forks, or resumes (any path through `handleSessionChange`) — even after the bridge has already reattached once
- **THEN** the emitted `session_register` for the new session id SHALL include `registerReason: "spawn"`

#### Scenario: Legacy bridge omits the field
- **WHEN** a bridge built before this change emits `session_register` without a `registerReason` field
- **THEN** the server SHALL accept the message and behave as if `registerReason: "spawn"` was specified

#### Scenario: Field type is restricted to the two literals
- **WHEN** the protocol type definition is compiled
- **THEN** `SessionRegisterMessage.registerReason` SHALL be typed as `"spawn" | "reattach" | undefined`
