## ADDED Requirements

### Requirement: GET /api/sessions/:sessionId/tool-result/:toolCallId

The dashboard server SHALL expose `GET /api/sessions/:sessionId/tool-result/:toolCallId` returning the full final result string for a completed tool call, looked up from `MemoryEventStore`. This endpoint exists so the UI can fetch the complete output on demand when the truncated rendered text was capped to its last N lines.

The route SHALL be guarded by the same network guard used by other session routes.

#### Scenario: Completed tool call returns full result
- **WHEN** a session has emitted a `tool_execution_end` event for `toolCallId = "abc"` with a 1000-line `result`
- **AND** the client requests `GET /api/sessions/:sessionId/tool-result/abc`
- **THEN** the response SHALL be `200` with `{ result: "<full 1000-line string>", isError: false }`

#### Scenario: Tool call still in flight
- **WHEN** the session has emitted `tool_execution_start` for `toolCallId = "abc"` but no `tool_execution_end`
- **THEN** the response SHALL be `404` with `{ error: "tool call still in flight or unknown" }`

#### Scenario: Tool call evicted from memory buffer
- **WHEN** the per-session ring buffer has evicted the `tool_execution_end` event under memory pressure
- **THEN** the response SHALL be `404` (same body as in-flight case)
