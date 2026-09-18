## Purpose

Connects a dashboard instance to a Discord guild over an outbound-only gateway connection, so a team can observe and steer pi sessions from Discord without the dashboard exposing any new inbound network surface.

## ADDED Requirements

### Requirement: Outbound-only connectivity
The plugin SHALL establish its Discord connection as an outbound client connection. It MUST NOT open a listening port, register an inbound HTTP route, or require a tunnel to function.

#### Scenario: Dashboard reachable only on loopback
- **WHEN** the dashboard is bound to loopback with no tunnel active and the plugin is enabled with a valid bot token
- **THEN** the bot appears online in the guild and processes commands normally

#### Scenario: No inbound surface added
- **WHEN** the plugin is enabled
- **THEN** the set of routes served by the dashboard is unchanged from the disabled state

### Requirement: Disabled by default and inert without a token
The plugin SHALL be disabled by default. When enabled without a configured bot token it SHALL report a degraded status and take no Discord action.

#### Scenario: Enabled with no token
- **WHEN** an operator enables the plugin but has configured no bot token
- **THEN** the plugin reports a configuration error in its health entry
- **AND** no gateway connection is attempted

### Requirement: Failure isolation
A plugin fault SHALL NOT degrade dashboard operation. Connection state and last error SHALL be observable in `/api/health.plugins[]`.

#### Scenario: Gateway connection fails
- **WHEN** the Discord gateway is unreachable or the token is rejected
- **THEN** the dashboard continues serving all routes and sessions normally
- **AND** `/api/health.plugins[]` reports the plugin as unhealthy with the failure reason

#### Scenario: Transient disconnect
- **WHEN** the gateway connection drops
- **THEN** the plugin reconnects with bounded exponential backoff
- **AND** resumes without duplicating messages already delivered

### Requirement: Bot token confidentiality
The bot token SHALL be stored in plugin configuration on the dashboard host and SHALL NOT be returned by any read API, rendered in the settings UI after saving, or written to logs.

#### Scenario: Reading plugin config after saving a token
- **WHEN** a client reads the plugin's configuration
- **THEN** the token field is absent or redacted, never the plaintext value

### Requirement: Settings surface on the dashboard only
All plugin configuration — principals, role mappings, tier ceiling, mirror filter, bindings, token — SHALL be editable only through the dashboard settings surface.

#### Scenario: Attempt to change authorization from Discord
- **WHEN** any Discord user, at any tier, sends a message or command intended to alter principals, tiers, ceiling, or filter settings
- **THEN** the plugin refuses and takes no configuration action
