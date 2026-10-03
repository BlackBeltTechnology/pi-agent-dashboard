## ADDED Requirements

### Requirement: The dashboard MCP server is registered per session by the bridge

A pi session on the dashboard's machine SHALL reach `/mcp` through a `pi-dashboard` MCP server that the bridge registers for that session with pi's extension MCP registration, carrying the session's delivered bearer credential as an `Authorization` header and the `/mcp` URL the server delivered with it. The bridge SHALL register only after the credential is delivered, SHALL re-register when a new credential is delivered (replacing the earlier registration), and SHALL unregister when the session shuts down. A delivery without a URL SHALL NOT be registered and SHALL be reported as registration unavailable. The operator SHALL NOT be required to edit an MCP config file, copy a token, or run a pairing flow. The credential SHALL resolve to a caller identity the server recorded, never to anything the MCP client asserts. The registration SHALL rely on pi's protocol negotiation and SHALL NOT require a revision pi's client does not offer; the dual-era endpoint serves the revision pi declares.

#### Scenario: Legacy-era pi client is served
- **WHEN** pi's MCP client declares a legacy revision such as `2025-11-25`
- **THEN** `tools/list` and a `pi-dashboard` tool call SHALL succeed for that session

#### Scenario: Session reaches /mcp without configuration
- **WHEN** a dashboard-connected pi session starts and its credential is delivered
- **THEN** pi SHALL list a connected `pi-dashboard` MCP server for that session
- **AND** a call to a `pi-dashboard` tool SHALL authenticate as that session

#### Scenario: Re-mint replaces the registration
- **WHEN** the dashboard restarts and re-delivers a new credential to a running session
- **THEN** the session's `pi-dashboard` server SHALL use the new credential without the operator restarting the session

#### Scenario: Nothing is written to mcp.json
- **WHEN** the registration happens
- **THEN** no MCP config file SHALL be created or modified

### Requirement: The delivered MCP credential SHALL NOT be placed in the pi process environment

The bridge SHALL hold the delivered credential in memory and pass it only in the MCP registration. It SHALL NOT assign it to any environment variable of the pi process, so subprocesses the session spawns cannot inherit it.

#### Scenario: Subprocess cannot read the credential
- **WHEN** a session with a delivered credential runs a bash command that prints its environment
- **THEN** the output SHALL NOT contain the credential or a `PI_DASHBOARD_MCP_TOKEN` variable

### Requirement: The previously provisioned mcp.json entry is migrated away

On startup the dashboard SHALL remove a `pi-dashboard` entry that an earlier build provisioned into the Pi-global `mcp.json`, identified by its dashboard-owned shape. The write SHALL be merge-only and atomic, SHALL preserve every other entry and key, and SHALL leave an unparseable file untouched. An operator-authored entry of the same name that does not match the provisioned shape SHALL be left in place and reported, because a file entry takes precedence over the bridge registration.

#### Scenario: Provisioned entry is removed
- **WHEN** `~/.pi/agent/mcp.json` contains the provisioned `pi-dashboard` entry and another server
- **THEN** after startup only the other server remains

#### Scenario: Operator entry is kept and reported
- **WHEN** `~/.pi/agent/mcp.json` contains a `pi-dashboard` entry the operator wrote with a different shape
- **THEN** the entry SHALL be preserved
- **AND** the doctor SHALL report that it shadows the dashboard's registration

### Requirement: The dashboard SHALL NOT take over pi's /mcp command

No dashboard package SHALL register a pi slash command named `mcp`, because doing so disables pi's built-in MCP support.

#### Scenario: Built-in MCP stays active
- **WHEN** a pi session loads every dashboard extension
- **THEN** `/mcp` SHALL be served by pi's built-in MCP extension

## MODIFIED Requirements

### Requirement: Delivered credentials survive neither a restart nor the session's end
Because the token registry is in-memory, a dashboard restart SHALL invalidate
every delivered credential. The delivery path SHALL re-run so a session recovers
a working credential without operator action. No delivered credential SHALL be
written to disk.

#### Scenario: Restart re-delivers rather than stranding
- **WHEN** the dashboard restarts while a pi session is running
- **AND** the session's bridge reconnects
- **THEN** a fresh credential SHALL be delivered to that session
- **AND** the session SHALL reach `/mcp` again without operator action

#### Scenario: A stale credential is not left behind
- **WHEN** a session ends
- **THEN** its `pi-dashboard` registration SHALL be removed
- **AND** presenting its credential SHALL be refused

#### Scenario: Delivery failure is surfaced, never silent
- **WHEN** credential delivery fails
- **THEN** the failure SHALL be logged with the affected session id
- **AND** the dashboard SHALL continue serving `/mcp` to other callers

#### Scenario: Delivery failure is logged by the side that can see it
- **WHEN** registration fails on the session side
- **THEN** the bridge SHALL log it with the session id
- **AND** a failure that is structurally invisible to the server SHALL NOT be the only record of it

## REMOVED Requirements

### Requirement: Dashboard MCP entry is provisioned into the user MCP config

**Reason**: File provisioning with an adapter-only header command is replaced by per-session registration.

**Migration**: See "The dashboard MCP server is registered per session by the bridge" and "The previously provisioned mcp.json entry is migrated away".

### Requirement: Endpoint naming avoids collision with the pi MCP adapter

**Reason**: `pi-mcp-adapter` is no longer supported.

**Migration**: See "The dashboard SHALL NOT take over pi's /mcp command".

### Requirement: Adapter version floor is consumed, not probed

**Reason**: No adapter; the pi floor governs MCP support.

**Migration**: None.

### Requirement: A local pi session obtains a working /mcp credential without manual configuration

**Reason**: Restated for registration-based delivery.

**Migration**: See "The dashboard MCP server is registered per session by the bridge".

### Requirement: A credential written to disk is protected and never clobbers operator config

**Reason**: Credentials are no longer written to any MCP config file.

**Migration**: See "The delivered MCP credential SHALL NOT be placed in the pi process environment".
