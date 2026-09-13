## ADDED Requirements

### Requirement: Adapter version floor is consumed, not probed

The dashboard MCP server plugin SHALL NOT own a `pi-mcp-adapter` version probe. When it needs the adapter verdict (for the provisioning surface or diagnostics) it SHALL consume the `mcp-client.config` service at call time. The plugin SHALL NOT declare `dependsOn: ["mcp-client"]`, so the dashboard endpoint keeps working when the MCP client plugin is disabled.

#### Scenario: Verdict sourced from mcp-client

- **WHEN** the provisioning surface reports the adapter version state and `mcp-client` is enabled
- **THEN** the reported verdict equals the one `mcp-client` reports

#### Scenario: Absent mcp-client degrades to unknown

- **WHEN** `mcp-client` is disabled or absent
- **THEN** the adapter version state is reported as unknown
- **AND** the MCP endpoint itself remains available

#### Scenario: Below-floor warning moves to the first MCP request

- **WHEN** the installed adapter is below the floor and the first request reaches the plugin's `/mcp` route
- **THEN** the plugin logs the below-floor warning once
- **AND** no warning is logged at registration

## MODIFIED Requirements

### Requirement: Dashboard MCP entry is provisioned into the user MCP config
The dashboard SHALL provision its own entry into the adapter's Pi-global config file (`~/.pi/agent/mcp.json` by default, resolved through the adapter's path helper so a custom agent directory is honoured) so a local pi session can reach the endpoint. The write SHALL go through the MCP client package's core writer (a package dependency, not a plugin dependency), sharing its JSONC parsing, servers-key alias handling, hardened atomic IO and refusal set. The entry SHALL declare a protocol version selection that negotiates or pins the modern era rather than relying on the adapter's legacy default.

#### Scenario: Entry declares protocol negotiation
- **WHEN** the dashboard writes its `mcpServers` entry
- **THEN** the entry SHALL set a protocol version selection of `auto` or a pinned `2026-07-28`
- **AND** it SHALL NOT omit the protocol version selection

#### Scenario: Entry uses the HTTP server shape
- **WHEN** the dashboard writes its `mcpServers` entry
- **THEN** the entry SHALL declare the endpoint by `url`
- **AND** it SHALL NOT use the stdio `command` shape used for local stdio servers

#### Scenario: Entry occupies the reserved pi-dashboard key
- **WHEN** the dashboard writes its `mcpServers` entry
- **THEN** it SHALL be written under the key `pi-dashboard`

#### Scenario: A foreign entry under the reserved key is never clobbered
- **WHEN** the Pi-global file's servers already hold an entry under `pi-dashboard` that does not declare a `url` (checked by a layer-level read of that file only)
- **THEN** the writer SHALL refuse the write and surface an error
- **AND** the existing file SHALL be left unmodified

#### Scenario: An existing dashboard entry is refreshed
- **WHEN** `mcpServers` already holds an entry under `pi-dashboard` that declares a `url`
- **THEN** the writer SHALL update every field the dashboard owns (`url`, the protocol version selection) to the current values
- **AND** operator-added fields on that entry (for example `disabled` or `headers`) SHALL be preserved

#### Scenario: Sibling entries are preserved
- **WHEN** the write occurs and the file already contains other `mcpServers` entries
- **THEN** every sibling entry SHALL be preserved unchanged

#### Scenario: Write is atomic
- **WHEN** the write occurs
- **THEN** it SHALL be performed via a temporary file and rename
- **AND** a partially-written file SHALL never be observable

#### Scenario: Unparseable config is refused, not repaired
- **WHEN** the existing file is present but the adapter's own parser (JSON with comments and trailing commas) cannot parse it
- **THEN** the write SHALL be refused and surfaced
- **AND** the existing file SHALL be left unmodified

#### Scenario: Server name does not collide
- **WHEN** the entry is written
- **THEN** its server name SHALL NOT be one already owned by another provisioner

#### Scenario: Commented config is provisioned
- **WHEN** the existing file contains comments or trailing commas that the adapter parses
- **THEN** the dashboard entry is written and every other entry is preserved

#### Scenario: Alias servers key is preserved
- **WHEN** the existing file defines servers under `mcp-servers`
- **THEN** the entry is written under `mcp-servers`
- **AND** no `mcpServers` key is added

#### Scenario: Custom agent directory is provisioned
- **WHEN** `PI_CODING_AGENT_DIR` points at a custom directory
- **THEN** the dashboard entry is written to `<custom>/mcp.json`
