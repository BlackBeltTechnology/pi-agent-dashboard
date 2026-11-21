## MODIFIED Requirements

### Requirement: Session prompt REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/prompt` endpoint that sends a text prompt to the specified session. The endpoint SHALL accept a JSON body with `text` (required), optional `images` array, and optional `delivery` (`"steer"` or `"followUp"`, the existing `send_prompt` field). `delivery` SHALL be forwarded on `send_prompt` unchanged; when absent it SHALL be omitted (the bridge treats it as `followUp`). Any other `delivery` value SHALL yield HTTP 400. A steer sent this way SHALL reach the bridge as the same `send_prompt` message the WebSocket path forwards (plus the REST route's `promptId`), so the bridge handles it exactly as a browser steer.

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

#### Scenario: Steer while streaming is handled like a browser steer
- **WHEN** a pi-bridge session is streaming and a request carries `{ "text": "focus on X", "delivery": "steer" }`
- **THEN** the bridge SHALL handle it exactly as for a browser `send_prompt` with `delivery: "steer"` (held in the bridge steer buffer, pending steer bubble, cancellable until hand-off — behaviour owned by `mid-turn-prompt-queue`, unchanged here)
- **AND** an ACP-backed session queues it as a follow-up, as it does for a browser steer

#### Scenario: Absent delivery is not defaulted by the server
- **WHEN** a request is received with `{ "text": "hello" }`
- **THEN** the `send_prompt` message SHALL carry no `delivery` field

#### Scenario: Invalid delivery is rejected
- **WHEN** a request is received with `{ "text": "hi", "delivery": "now" }` or a non-string `delivery`
- **THEN** the server SHALL respond 400 with `{ success: false, error: "delivery must be \"steer\" or \"followUp\"" }`
- **AND** no `send_prompt` SHALL be sent

#### Scenario: Invalid delivery takes precedence over session lookup
- **WHEN** a request is received for a non-existent session with `{ "text": "hi", "delivery": "now" }`
- **THEN** the server SHALL respond 400 (the `delivery` check runs before the session lookup)

#### Scenario: Valid delivery for an unknown session is not found
- **WHEN** a request is received for a non-existent session with `{ "text": "hi", "delivery": "steer" }`
- **THEN** the server SHALL respond 404 `{ success: false, error: "session not found" }` and send nothing
