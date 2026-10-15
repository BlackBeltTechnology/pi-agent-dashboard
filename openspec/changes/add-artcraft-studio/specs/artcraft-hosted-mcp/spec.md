## Purpose
Expose ArtCraft's hosted MCP service to pi as a local stdio MCP server — disabled until explicitly configured, gated by a one-time acknowledgement that tool calls spend ArtCraft credits, and registered only on request.

## ADDED Requirements

### Requirement: Feature flag
`pi-craft artcraft mcp` SHALL be disabled unless `ARTCRAFT_MCP_URL` is set to an `https` URL; when disabled it SHALL exit `1` explaining that ArtCraft's hosted MCP endpoint is not configured, without any network request.

#### Scenario: Flag unset
- **WHEN** `pi-craft artcraft mcp` runs without `ARTCRAFT_MCP_URL`
- **THEN** no network request is made and the exit code is `1`

#### Scenario: Non-https URL rejected
- **WHEN** `ARTCRAFT_MCP_URL=http://example.test/mcp`
- **THEN** the bridge does not start and the exit code is `1`

### Requirement: Authenticated bridge
When enabled and a session exists, the bridge SHALL relay MCP messages between pi (stdio) and the hosted endpoint, presenting the session token, SHALL refresh the session once on an authentication failure and retry, and SHALL fail the call with a clear error if the retry also fails. It SHALL forward `tools/call` requests one at a time and SHALL keep stdout free of anything but MCP messages. Without a session it SHALL exit `1` naming `pi-craft artcraft login`.

#### Scenario: Expired session refreshed transparently
- **WHEN** a tool call receives an authentication failure and the refresh succeeds
- **THEN** the call is retried once and its result returned to pi

### Requirement: Credit-spend acknowledgement
Before the first tool call on a machine, the bridge SHALL require the user to have run `pi-craft artcraft mcp --accept-credit-use` (recorded locally); until then every `tools/call` SHALL return an MCP error explaining that ArtCraft tool calls spend account credits and how to accept.

#### Scenario: Not yet accepted
- **WHEN** pi calls an ArtCraft tool before acceptance
- **THEN** the call returns an error naming `--accept-credit-use` and nothing is sent upstream

### Requirement: Lazy registration
`pi-craft artcraft mcp --register` SHALL add an `artcraft` entry to the project's `.pi/mcp.json` with the same preservation and notice rules as the craft app servers; no other command SHALL register it.

#### Scenario: Register preserves other servers
- **WHEN** `.pi/mcp.json` already defines `craft-filmcraft`
- **THEN** after registration it is unchanged and `artcraft` is added
