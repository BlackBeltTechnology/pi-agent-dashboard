# session-status-banner (delta)

## ADDED Requirements

### Requirement: Settled-error Retry is dispatched as a typed protocol message

The settled-error **Retry** action SHALL be dispatched as a first-class
`retry_session` protocol message `{ type: "retry_session"; sessionId: string }`,
NOT by sending a `send_prompt` whose `text` is the sentinel `/__dashboard_retry`.
The message SHALL traverse three hops, each of which SHALL carry the type: the
browser→server union (`browser-protocol.ts`), the server→bridge union
(`protocol.ts` `ServerToExtensionMessage`), and the server gateway routing that
forwards a browser `retry_session` to the owning session bridge. The underlying
pi call the bridge makes SHALL remain
`pi.sendMessage({ customType: "pi-dashboard:retry", display: false },
{ triggerTurn: true })` — this change alters the transport, not the pi call.

The client SHALL preserve the pre-dispatch stale-click guard: it SHALL NOT
dispatch when `lastError` is absent, or `retryState` is set, or `retryCancelled`
is set, or `isStreaming` is true.

#### Scenario: Client dispatches retry_session, not the sentinel prompt
- **GIVEN** a session with `lastError` set, `retryState` undefined,
  `retryCancelled` false, `isStreaming` false
- **WHEN** the user activates the settled-error Retry control
- **THEN** the client SHALL send `{ type: "retry_session", sessionId }`
- **AND** it SHALL NOT send a `send_prompt` carrying `/__dashboard_retry`

#### Scenario: Stale-click guard blocks dispatch in every ineligible state
- **WHEN** Retry is activated while ANY of: `lastError` absent, `retryState`
  set, `retryCancelled` set, or `isStreaming` true
- **THEN** the client SHALL send no `retry_session` message

#### Scenario: Server forwards retry_session to the owning bridge
- **GIVEN** a browser `retry_session { sessionId }` for a live, bridged session
- **WHEN** the server gateway receives it
- **THEN** it SHALL forward a `retry_session` to that session's bridge
- **AND** it SHALL NOT drop it through the unknown-type default path

#### Scenario: Bridge re-drives the turn via the custom-message primitive
- **GIVEN** the bridge receives `retry_session` for an idle settled session
- **WHEN** it handles the message
- **THEN** it SHALL call `pi.sendMessage({ customType: "pi-dashboard:retry",
  display: false }, { triggerTurn: true })`
- **AND** a native `agent_start` for the re-driven turn SHALL follow
- **AND** no user message SHALL be appended or replayed

### Requirement: A manual retry is not mapped onto the auto-retry surface

A `retry_session`-initiated turn SHALL NOT render pi's auto-retry attempt
counter. The bridge SHALL guard against a still-armed `RetryTracker` chain
converting the manual turn's `agent_start` into a synthetic `auto_retry_start`.

#### Scenario: Armed tracker chain does not synthesize a counter for a manual retry
- **GIVEN** a `RetryTracker` chain is still armed for the session
- **WHEN** the manual `retry_session` turn emits `agent_start`
- **THEN** the bridge SHALL NOT forward a synthetic `auto_retry_start` for it
- **AND** no attempt counter SHALL render on the banner

#### Scenario: Dispatch failure surfaces as an error, not a counter
- **GIVEN** `pi.sendMessage` throws synchronously OR rejects asynchronously
- **WHEN** the bridge handles the failure
- **THEN** it SHALL forward `auto_retry_end { success: false, attempt: 0,
  finalError }`
- **AND** the banner SHALL show the error with no attempt counter

### Requirement: Undeliverable retry is negatively acked, never silently dropped

When the server or bridge cannot deliver a `retry_session` (unknown or
disconnected session, or a bridge lacking the handler), it SHALL emit a
structured `retry_session_error` to the sender (mirroring `plugin_action_error`),
never a silent drop. The client SHALL re-enable the one-shot Retry control and
surface a toast on receipt.

#### Scenario: Unknown/disconnected session yields a structured error
- **GIVEN** a `retry_session` for a session with no reachable bridge
- **WHEN** the server processes it
- **THEN** it SHALL send `retry_session_error { sessionId, error }` to the sender
- **AND** the client SHALL re-enable Retry and toast the error

### Requirement: The /__dashboard_retry sentinel remains a deprecated alias

For backward compatibility with un-upgraded clients during a version-skew
window, the bridge SHALL continue to accept a `send_prompt` whose `text` equals
`/__dashboard_retry` and route it to the same retry handler as `retry_session`.
The alias SHALL NOT be removed in this change; removal is a separate change after
clients are known upgraded.

#### Scenario: Legacy sentinel still triggers a retry
- **GIVEN** an older client sends `send_prompt { text: "/__dashboard_retry" }`
- **WHEN** the bridge parses it
- **THEN** it SHALL invoke the same retry dispatch as `retry_session`
- **AND** it SHALL NOT append or replay the sentinel as a user message
