## MODIFIED Requirements

### Requirement: The dashboard MCP server is registered per session by the bridge

A pi session on the dashboard's machine SHALL reach `/mcp` through a `pi-dashboard` MCP server that the bridge registers for that session with pi's extension MCP registration, carrying the session's delivered bearer credential as an `Authorization` header and the `/mcp` URL the server delivered with it. The bridge SHALL register only after the credential is delivered, SHALL re-register when a new credential is delivered (replacing the earlier registration), and SHALL unregister when the session shuts down. A delivery without a URL SHALL NOT be registered and SHALL be reported as registration unavailable. The operator SHALL NOT be required to edit an MCP config file, copy a token, or run a pairing flow. The credential SHALL resolve to a caller identity the server recorded, never to anything the MCP client asserts. The registration SHALL rely on pi's protocol negotiation and SHALL NOT require a revision pi's client does not offer; the dual-era endpoint serves the revision pi declares. A session spawned with pi's `--no-mcp` (plugin spawn scope `noMcp`, which every team session sets) runs without pi's built-in MCP support: the bridge's registration SHALL still be attempted and SHALL NOT be reported as registration unavailable, but no `pi-dashboard` server connects in that session, and the connected-server guarantee below SHALL NOT apply to it.

#### Scenario: Legacy-era pi client is served
- **WHEN** pi's MCP client declares a legacy revision such as `2025-11-25`
- **THEN** `tools/list` and a `pi-dashboard` tool call SHALL succeed for that session

#### Scenario: Session reaches /mcp without configuration
- **WHEN** a dashboard-connected pi session that was not spawned with `--no-mcp` starts and its credential is delivered
- **THEN** pi SHALL list a connected `pi-dashboard` MCP server for that session
- **AND** a call to a `pi-dashboard` tool SHALL authenticate as that session

#### Scenario: Re-mint replaces the registration
- **WHEN** the dashboard restarts and re-delivers a new credential to a running session
- **THEN** the session's `pi-dashboard` server SHALL use the new credential without the operator restarting the session

#### Scenario: Nothing is written to mcp.json
- **WHEN** the registration happens
- **THEN** no MCP config file SHALL be created or modified

#### Scenario: A --no-mcp session registers without connecting
- **WHEN** a team session spawned with `--no-mcp` starts and its credential is delivered
- **THEN** the bridge's registration SHALL complete without a registration-unavailable report
- **AND** pi SHALL list no connected `pi-dashboard` server for that session
