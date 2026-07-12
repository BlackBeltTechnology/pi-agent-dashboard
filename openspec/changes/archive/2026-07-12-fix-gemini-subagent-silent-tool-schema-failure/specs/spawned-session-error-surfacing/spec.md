## ADDED Requirements

### Requirement: Model-turn errors from spawned sessions SHALL be surfaced

When a dashboard-spawned child `pi` session's model call fails — provider non-2xx response, a thrown adapter error, or a blocked/safety terminal stop — the dashboard SHALL surface a structured error to the originating session card AND write a corresponding line to `~/.pi/dashboard/server.log`. The error SHALL NOT be dropped inside the child process boundary.

Evidence anchor: during spawned-session failures, `server.log` currently contains only gateway/session-lifecycle rows and **zero model-turn outcomes**; the model call runs inside the child `pi --mode rpc` process and its errors never reach the dashboard.

#### Scenario: Provider non-2xx reaches the card and log
- **WHEN** a spawned session's model call returns a provider error (e.g. HTTP 4xx/5xx)
- **THEN** the dashboard session card SHALL display an error state with the provider status and message
- **AND** a corresponding error line SHALL be appended to `server.log`

#### Scenario: Thrown adapter error is surfaced
- **WHEN** the model adapter throws while handling a spawned session's turn
- **THEN** the dashboard SHALL surface the error to the card and `server.log` rather than leaving the turn silent

#### Scenario: Blocked/safety terminal stop is surfaced
- **WHEN** a spawned session's turn ends with a safety/blocked terminal reason
- **THEN** the dashboard SHALL surface a non-silent status conveying the block reason

### Requirement: Surfaced errors SHALL NOT leak sensitive content

Surfaced errors SHALL include only the provider/adapter status, the error message, and model/session/turn identifiers. They SHALL NOT include full request bodies, message content, credentials, tokens, or headers.

#### Scenario: Credentials are not written to the log or card
- **WHEN** an error is surfaced for a spawned session
- **THEN** the card text and `server.log` line SHALL contain no API keys, bearer tokens, or credential-file contents
- **AND** SHALL NOT contain the full request body

### Requirement: Error surfacing SHALL be distinct from the empty-actionable case

A thinking-only / empty-actionable completion (`stopReason = stop`, no error) SHALL NOT be reported through the error-surfacing path. It is handled by the empty-actionable-turn guard as a non-error status. Only genuine errors (non-2xx, thrown, blocked) SHALL be surfaced as errors.

#### Scenario: Empty-actionable turn is not reported as an error
- **WHEN** a spawned session produces a thinking-only `stop` turn with no provider error
- **THEN** the error-surfacing path SHALL NOT fire
- **AND** the empty-actionable-turn guard SHALL handle it instead
