# Spec Delta

## MODIFIED Requirements

### Requirement: Session action handler extraction
browser-gateway.ts SHALL delegate action messages (`send_prompt`, `abort`, `resume_session`, `spawn_session`, `shutdown`) to a session action handler module. Flow commands SHALL arrive as `plugin_action` messages handled by the flows plugin server, not as a core action message.

#### Scenario: Send prompt forwards to pi gateway
- **WHEN** browser sends a send_prompt for an active session
- **THEN** the session action handler forwards to piGateway

#### Scenario: Send prompt to ended session triggers auto-resume
- **WHEN** browser sends a send_prompt for an ended session
- **THEN** the session action handler queues the prompt and spawns a pi process to continue

#### Scenario: Flow command is a plugin action
- **WHEN** the browser sends a flow abort for a session
- **THEN** it SHALL arrive as `plugin_action` with `pluginId: "flows"` and be handled by the flows plugin server
- **AND** the session action handler SHALL NOT handle a `flow_control` message type
