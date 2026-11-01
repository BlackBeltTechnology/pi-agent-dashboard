## MODIFIED Requirements

### Requirement: A session cannot drive itself through the MCP endpoint
The server SHALL refuse a tool call whose target session equals the caller's
server-resolved originating session. This SHALL apply to every session-targeting
tool in the manifest, including prompt delivery that routes to extension-command
dispatch, model and thinking-level changes, lifecycle tools and hard kill. The tier check SHALL run before the self-target check.

#### Scenario: Self-targeted prompt is refused
- **WHEN** a caller whose originating session resolves to `A` invokes a session-targeting tool with `sessionId` equal to `A`
- **THEN** the server SHALL refuse the call
- **AND** it SHALL NOT deliver the prompt

#### Scenario: Self-targeted slash command is refused
- **WHEN** a caller whose originating session resolves to `A` invokes prompt delivery targeting `A` with text beginning `/`
- **THEN** the server SHALL refuse the call
- **AND** it SHALL NOT reach extension-command dispatch

#### Scenario: Every session-targeting manifest row is guarded
- **WHEN** the manifest is enumerated
- **THEN** every row whose schema has a `sessionId` argument SHALL be marked session-targeting
- **AND** a caller whose originating session resolves to `A` invoking any such tool with `sessionId` equal to `A` SHALL be refused

#### Scenario: Cross-session control is permitted
- **WHEN** a caller whose originating session resolves to `A` targets a different session `B`
- **THEN** the call SHALL be permitted subject to the remaining authorization rules

#### Scenario: Sessionless caller is unaffected
- **WHEN** a caller with no originating session targets any session
- **THEN** the self-target guard SHALL NOT refuse the call

#### Scenario: Refusal is observable
- **WHEN** a self-targeted call is refused
- **THEN** the refusal SHALL be recorded with the resolved caller session, the target session, and the tool name

## ADDED Requirements

### Requirement: Prompt answers are not an MCP capability
The MCP endpoint SHALL NOT expose answering an agent prompt as a tool to any caller. `prompt_response` and `extension_ui_response` SHALL be neither advertised nor callable for any token type or tier, and SHALL be on the manifest denylist with a reason stating that agent prompt answers stay human-in-the-loop.

#### Scenario: tools/list never advertises the answer tools
- **WHEN** a caller of any tier, authenticated by a per-session token or by a device token, issues `tools/list`
- **THEN** the result SHALL contain neither `prompt_response` nor `extension_ui_response`

#### Scenario: tools/call returns the standard unknown-tool error
- **WHEN** a caller invokes `tools/call` with name `prompt_response` or `extension_ui_response`
- **THEN** the server SHALL return the same unknown-tool error it returns for any name not in the manifest
- **AND** nothing SHALL be forwarded to any session

#### Scenario: Cross-session answer attempt reaches nothing
- **WHEN** a caller whose originating session resolves to `A` invokes `prompt_response` with `sessionId` equal to `B`
- **THEN** the server SHALL return the unknown-tool error
- **AND** session `B` SHALL receive no message

#### Scenario: Denylist records the reason
- **WHEN** the denylist is enumerated
- **THEN** it SHALL contain `prompt_response`, `extension_ui_response` and `/api/session/:id/extension-ui-response`, each with a reason containing "agent prompt answers stay human-in-the-loop"

#### Scenario: Manifest stays total after the removal
- **WHEN** the manifest completeness test runs
- **THEN** the verb `prompt_response` and the route `/api/session/:id/extension-ui-response` SHALL be covered by the denylist
- **AND** no manifest row SHALL bind them

#### Scenario: Non-MCP answer roads are unchanged
- **WHEN** a prompt is answered through the dashboard UI, the chat gateway, `POST /api/questions/:id/answer`, the browser WebSocket `prompt_response` message or `POST /api/access/prompts/:promptId`
- **THEN** the answer SHALL be delivered exactly as before this change
