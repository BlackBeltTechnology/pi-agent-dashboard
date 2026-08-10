# spawned-turn-outcome-logging Specification

## Purpose

Build redacted `server.log` lines that make a spawned/child session's turn outcome visible on the dashboard server. Two outcomes otherwise cross the child→dashboard boundary invisibly: an empty-actionable stop (a clean-but-empty, thinking-only turn) and a genuine model-turn error inside the child `pi --mode rpc` process. Line builders are pure (no I/O); callers emit the returned string to stdout, which is redirected to `server.log`.

## Requirements

### Requirement: Redact credentials from surfaced messages

The system SHALL strip credential-like substrings from any error or status message before it appears in a surfaced log line, so no token, key, or credential reaches `server.log` verbatim.

#### Scenario: Bearer token in message

- **WHEN** a message contains `Bearer <token>`
- **THEN** the token is replaced with `Bearer [REDACTED]`

#### Scenario: Provider API keys and OAuth tokens

- **WHEN** a message contains a Google (`AIza…`), OAuth (`ya29.…`), or OpenAI-style (`sk-…`) key of 10+ trailing characters
- **THEN** the key is replaced with `[REDACTED]`

#### Scenario: Long opaque credential blobs

- **WHEN** a message contains an opaque base64/hex-like blob of 40 or more non-whitespace characters
- **THEN** the blob is replaced with `[REDACTED]`
- **AND** specific credential shapes are redacted before the broad long-blob rule so they receive their own labelled replacement

### Requirement: Emit a non-error line for an empty-actionable turn

The system SHALL produce a NON-error log line when a spawned session returns only reasoning and no actionable answer (a clean-but-empty stop).

#### Scenario: Empty-actionable line with model

- **WHEN** an empty-actionable turn is logged with a session id, a model, and a message
- **THEN** the line reads `[dashboard] empty-actionable turn: session=<sessionId> model=<model> — <redactedMessage>`

#### Scenario: Empty-actionable line without model

- **WHEN** an empty-actionable turn is logged with no model
- **THEN** the `model=…` segment is omitted from the line
- **AND** the message is passed through redaction

### Requirement: Emit an error line for a failed model turn

The system SHALL produce an ERROR log line when a spawned session's model turn fails, including optional model and stop-reason identifiers.

#### Scenario: Model-turn error line with model and stopReason

- **WHEN** a model-turn error is logged with a session id, model, stop reason, and message
- **THEN** the line reads `[dashboard] spawned-session model-turn error: session=<sessionId> model=<model> stopReason=<stopReason> — <redactedMessage>`

#### Scenario: Optional segments omitted

- **WHEN** a model-turn error is logged without a model or without a stop reason
- **THEN** the corresponding `model=…` or `stopReason=…` segment is omitted
- **AND** the message is passed through redaction

### Requirement: Extract a genuine model-turn error from a forwarded event

The system SHALL derive a model-turn error only from the terminal assistant message of a forwarded `agent_end` event's `messages` array, and SHALL NOT treat the empty-actionable stop case as an error.

#### Scenario: Terminal assistant message with error stop reason

- **WHEN** the last message is an assistant message with `stopReason === "error"`
- **THEN** an error is returned carrying the message, model, and stop reason
- **AND** the message is the message's `errorMessage` when present and non-empty, otherwise `model turn ended with an error`

#### Scenario: Model identifier composition

- **WHEN** the terminal assistant message carries both a provider and a model
- **THEN** the model identifier is `<provider>/<model>`
- **AND** when only a model is present, the model identifier is the model alone

#### Scenario: No matching terminal error

- **WHEN** the `messages` array is missing, empty, or its last message is not an assistant message with `stopReason === "error"`
- **THEN** no error is returned (`null`)
