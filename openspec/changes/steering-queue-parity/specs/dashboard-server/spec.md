## MODIFIED Requirements

### Requirement: Session prompt REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/prompt` endpoint that sends a text prompt to the specified session. The endpoint SHALL accept a JSON body with `text` (required), optional `images` array, and optional `delivery` (`"steer"` or `"followUp"`). `delivery` SHALL be forwarded on `send_prompt` unchanged; when absent it SHALL be omitted (the bridge treats it as `followUp`). Any other `delivery` value SHALL yield HTTP 400.

#### Scenario: Send prompt to active session
- **WHEN** a `POST /api/session/:id/prompt` request is received with `{ "text": "hello" }`
- **THEN** the server SHALL forward the prompt to the pi session via the pi-gateway and respond with `{ success: true }`

#### Scenario: Send prompt to unknown session
- **WHEN** a `POST /api/session/:id/prompt` request is received for a non-existent session
- **THEN** the server SHALL respond with `{ success: false, error: "session not found" }`

#### Scenario: Steer delivery is forwarded
- **WHEN** a `POST /api/session/:id/prompt` request is received with `{ "text": "focus on X", "delivery": "steer" }`
- **THEN** the server SHALL send `send_prompt` to the bridge with `delivery: "steer"`
- **AND** respond as for any accepted prompt

#### Scenario: Absent delivery is not defaulted by the server
- **WHEN** a request is received with `{ "text": "hello" }`
- **THEN** the `send_prompt` message SHALL carry no `delivery` field

#### Scenario: Invalid delivery is rejected
- **WHEN** a request is received with `{ "text": "hi", "delivery": "now" }` or a non-string `delivery`
- **THEN** the server SHALL respond 400 with `{ success: false, error: "delivery must be \"steer\" or \"followUp\"" }`
- **AND** no `send_prompt` SHALL be sent

## ADDED Requirements

### Requirement: Server writes pi RPC lines to a session's keeper for steer cancel

The server SHALL provide a keeper RPC writer that opens the session's keeper socket (path from the headless registry's persisted `keeperSockPath`, never from client input), writes a fixed set of JSON lines (`clear_queue`, `steer`) on one connection, and resolves once flushed. It SHALL NOT read pi's output. It SHALL serve only sessions with a registered `keeperSockPath`.

#### Scenario: Session without a keeper
- **WHEN** `cancel_steer_entry` targets a session with no `keeperSockPath`
- **THEN** the server SHALL answer `steer_cancel_result { status: "unsupported" }` and open no socket

#### Scenario: Lines are written in order on one connection
- **WHEN** the writer is given `[clear_queue, steer a, steer c]`
- **THEN** the keeper socket SHALL receive them as three newline-terminated JSON lines in that order on a single connection

#### Scenario: Unreachable socket
- **WHEN** the socket is missing, refused, or not flushed within 2 s
- **THEN** the writer SHALL reject and the server SHALL answer `failed` without sending `cancel_steer_commit`

#### Scenario: Unresponsive bridge
- **WHEN** no `steer_cancel_prepared` arrives within 5 s
- **THEN** the server SHALL answer `failed` and write nothing

#### Scenario: Malformed browser request
- **WHEN** `cancel_steer_entry` has a non-integer or negative `index` or a non-string `text`
- **THEN** the server SHALL drop it with an error log and send nothing to the bridge or keeper

