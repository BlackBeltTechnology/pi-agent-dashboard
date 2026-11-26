## ADDED Requirements

### Requirement: MCP send_prompt forwards the delivery mode

The MCP `send_prompt` tool SHALL accept an optional `delivery` (`"steer"` or `"followUp"`) and forward it on the `send_prompt` message to the session's bridge unchanged; when absent it SHALL be omitted (the bridge treats it as `followUp`). The plugin-context `sendToSession` SHALL accept an optional third argument `opts?: { delivery?: "steer" | "followUp" }`; callers passing only `(sessionId, text)` SHALL behave exactly as before. The tool's input schema SHALL reject any other `delivery` value.

#### Scenario: Steer delivery is forwarded
- **WHEN** a `control` caller invokes `send_prompt` with `{ sessionId: "S", text: "focus on X", delivery: "steer" }`
- **THEN** the bridge for `S` SHALL receive `{ type: "send_prompt", sessionId: "S", text: "focus on X", delivery: "steer" }`

#### Scenario: Absent delivery is not defaulted
- **WHEN** a `control` caller invokes `send_prompt` with `{ sessionId: "S", text: "hello" }`
- **THEN** the message sent to the bridge SHALL carry no `delivery` field

#### Scenario: Invalid delivery is rejected
- **WHEN** `send_prompt` is invoked with `delivery: "now"`
- **THEN** the call SHALL fail schema validation and nothing SHALL be sent to the bridge

#### Scenario: Existing two-argument callers are unchanged
- **WHEN** another plugin calls `ctx.sendToSession("S", "hello")`
- **THEN** the message sent SHALL be `{ type: "send_prompt", sessionId: "S", text: "hello" }` with no `delivery`

#### Scenario: Images remain ignored
- **WHEN** `send_prompt` is invoked with `images` (accepted by the schema) and any `delivery`
- **THEN** only `text` and `delivery` SHALL be forwarded; `images` SHALL continue to be ignored (pre-existing behaviour, out of scope)
