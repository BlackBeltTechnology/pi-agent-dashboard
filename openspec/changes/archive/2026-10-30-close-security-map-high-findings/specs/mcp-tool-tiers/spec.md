## MODIFIED Requirements

### Requirement: Session-targeting tools are covered end to end
The `control` tier SHALL include tools to set a session's model and
thinking level, edit the followup queue, resume, shut down, retry,
stop-after-turn, rename, tag and archive a session. Answering an agent prompt
(`ask_user`, extension UI request) is NOT an MCP tool at any tier (see
`dashboard-mcp-server`, "Prompt answers are not an MCP capability"). The `observe` tier SHALL
include tools to read a session's events from a sequence number, a tool
result, an attachment, a session diff, a session file and a transcript.

#### Scenario: ask_user answered over MCP
- **WHEN** a `control` caller looks for an MCP tool that answers a pending `ask_user` prompt
- **THEN** no such tool SHALL be listed, and neither `prompt_response` nor `extension_ui_response` SHALL be callable
- **AND** the prompt SHALL remain answerable through the non-MCP roads only: the dashboard UI, the chat gateway, the REST question API (`POST /api/questions/:id/answer`, non-file kinds), the browser WebSocket `prompt_response` message, and `POST /api/access/prompts/:promptId` (access prompts, `operate`)

#### Scenario: force_kill requires operate
- **WHEN** a `control` caller invokes `force_kill`
- **THEN** the call SHALL be refused with `scope="operate"`
- **AND** an `operate` caller invoking it SHALL terminate the session's process
