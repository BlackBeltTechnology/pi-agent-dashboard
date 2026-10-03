## ADDED Requirements

### Requirement: Plugin identity without an adapter requirement

The dashboard SHALL ship the first-party plugin `mcp-client` (npm `@blackbelt-technology/pi-dashboard-mcp-client-plugin`) as the manager of pi's built-in MCP configuration. No first-party plugin SHALL declare `pi-mcp-adapter` as a required pi extension or package dependency.

#### Scenario: No adapter requirement
- **WHEN** the plugins index is read
- **THEN** no plugin SHALL list `pi-mcp-adapter` under its requirements

### Requirement: Effective configuration follows pi's built-in MCP rules

The plugin SHALL compute the effective MCP configuration for a directory from exactly two layers: the Pi-global `~/.pi/agent/mcp.json` (honouring `PI_CODING_AGENT_DIR`) and, only when pi trusts the project, `<cwd>/.pi/mcp.json`. Project trust SHALL come from an injected trust predicate backed by pi's trust store; without one, every project SHALL count as untrusted. A project entry SHALL replace the global entry of the same name as a whole. Connection state and tool counts SHALL come from pi (`pi mcp list --json`) rather than being re-implemented; it SHALL run with a 30-second timeout and its result SHALL be cached per cwd for 30 seconds; its stdout SHALL be parsed whatever its exit code, and state SHALL be reported unknown only when the command cannot run, times out, or prints unparseable output. Each layer SHALL be parsed as strict JSON, as pi parses it; a layer that fails to parse SHALL be reported per layer, as skipped by pi, without hiding the other layer. Entry keys pi ignores (adapter-only keys such as `disabled`, `directTools`, `lifecycle`) SHALL be reported as ignored by pi.

#### Scenario: Non-zero exit still yields state
- **WHEN** `pi mcp list --json` exits `1` because one server is not connected and prints valid JSON
- **THEN** every server SHALL show pi's reported state, the disconnected one included

#### Scenario: Adapter disabled key is flagged
- **WHEN** a global entry carries `disabled: true` and no `enabled` key
- **THEN** the view SHALL report the entry as enabled under pi with `disabled` ignored, and offer converting it to `enabled: false`

#### Scenario: Project entry replaces global
- **WHEN** both layers define `docs` and the project is trusted
- **THEN** the effective `docs` entry SHALL be exactly the project entry, with no fields inherited from the global entry

#### Scenario: Untrusted project layer is inactive
- **WHEN** `<cwd>/.pi/mcp.json` exists but pi does not trust the project
- **THEN** its servers SHALL be reported as inactive with the reason "project not trusted"

### Requirement: Layer provenance uses the Pi vocabulary

Every server in an effective view SHALL carry provenance **Pi global** or **Pi folder**, and a folder entry that replaces a global one SHALL be marked as overriding it.

#### Scenario: Folder override is marked
- **WHEN** a trusted folder defines a server that also exists globally
- **THEN** the view SHALL show it as Pi folder, overriding Pi global

### Requirement: Writes are atomic, merge-only at the file level, and target one Pi layer

Every write SHALL target exactly one Pi layer (`global` → the Pi-global file, `project` → `<cwd>/.pi/mcp.json`). It SHALL replace or delete exactly one `mcpServers.<name>` entry, preserve every other entry and unrecognised key, write atomically, and refuse to write over an unparseable file. Server names SHALL be restricted to letters, digits, `_` and `-`, and SHALL NOT differ only in `-` versus `_` from another server other than the entry being replaced (at project scope: a server of that cwd's effective view; at global scope: an entry of the global file or of a known folder's trusted project layer, because pi would then drop that folder entry) (pi ≥ 0.99.2 maps both to one `mcp__<name>__` namespace and rejects the pair). An HTTP entry carrying `auth` SHALL be refused at project scope (pi reads `auth.provider` only from the global file and extensions). Refusals SHALL be reported as a closed set (`unparseable`, `entry-not-object`, `invalid-name`, `name-collision`, `transport-conflict`, `invalid-entry`, `write-failed` carrying the IO error code), shared by the service's write and check operations. Server names `__proto__`, `constructor` and `prototype` SHALL be refused at every entry point. A write SHALL be refused when pi's entry validation would reject the entry (transport `type`, `url` scheme, string-valued `headers` / `env`, positive `timeout`, `oauth` field shapes, https-or-loopback URL for `auth`).

#### Scenario: Global write colliding with a folder entry
- **WHEN** a known trusted folder's `.pi/mcp.json` defines `dev-radius` and a global write adds `dev_radius`
- **THEN** the write SHALL be refused naming the folder entry

#### Scenario: Entry pi would reject is refused
- **WHEN** a write sets `type: "sse"` or a `timeout` of `0`
- **THEN** the write SHALL be refused with the reason pi would give

#### Scenario: Prototype names refused
- **WHEN** a write names the server `__proto__`
- **THEN** the write SHALL be refused with a validation error

#### Scenario: Sibling entries survive
- **WHEN** a server is saved at global scope
- **THEN** every other server entry and top-level key in the file SHALL be unchanged

#### Scenario: Invalid name rejected
- **WHEN** a write names a server `my server`
- **THEN** the write SHALL be refused with a validation error

#### Scenario: Dash/underscore collision rejected
- **WHEN** the effective view has `dev-radius` and a write adds `dev_radius`
- **THEN** the write SHALL be refused naming both servers

#### Scenario: Provider auth refused in a project file
- **WHEN** a project-scope write contains `"auth": { "provider": "radius" }`
- **THEN** the write SHALL be refused, stating that provider auth is global-only

### Requirement: Enabled flag follows pi

Disabling a server SHALL write `enabled: false` on its entry in the chosen layer; enabling SHALL remove the `enabled` key. Disabling at project scope a server defined only globally SHALL create a copy of the effective entry in the project layer with `enabled: false`, because a project entry replaces the global one. The copy SHALL omit secret-bearing values (`headers`, `env`, `oauth.clientSecret`) and `auth`; they SHALL NOT be copied silently. Enabling such a copy SHALL offer removing the project entry (so the global entry applies again) or re-entering the omitted values.

#### Scenario: Disable a global-only server in a folder
- **WHEN** a global server with an `Authorization` header is disabled from a trusted folder
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain a copy of that entry with `enabled: false` and without the header value

### Requirement: Configuration schema is published for pi's entry shape

The plugin SHALL publish a JSON Schema for pi's MCP server entry: stdio (`command`, `args`, `env`, `cwd`) or HTTP (`url`, `headers`, `oauth` with `clientId`, `clientSecret`, `callbackPort`, `callbackUrl`, `scope`, `clientName`, `authServerMetadataUrl`, and `auth` with `provider`), plus `type`, `description`, `exposure` (`direct`, `codemode`, `deferred`, `hidden`; `codemode-deferred` accepted on read as pi's alias of `codemode` and preserved unless the user changes exposure), `toolExposure`, `timeout` and `enabled`. It SHALL mark secret fields and the transport exclusivity (`command` xor `url`) so clients render editors without hard-coded field lists.

#### Scenario: Legacy exposure alias preserved
- **WHEN** an entry has `exposure: "codemode-deferred"` and the user edits only its `description`
- **THEN** the saved entry SHALL keep `exposure: "codemode-deferred"` and the editor SHALL show it as `codemode`

#### Scenario: Both transports rejected
- **WHEN** a write would leave an entry with both `command` and `url`
- **THEN** the write SHALL be refused naming the transport conflict

#### Scenario: Existing dual-transport entry read as HTTP
- **WHEN** a file entry already has both `command` and `url`
- **THEN** the view SHALL show it with the transport pi picks (HTTP unless `type` is `stdio`) and flag the other key as ignored

### Requirement: In-process config service for dependent plugins

The plugin SHALL expose an `mcp-client.config` service, built by an exported factory taking injected file IO, the known-cwd set and an optional project-trust predicate, offering read effective view, ensure/remove server entry, set enabled, and check-config-files. A hostless process (a dependent plugin's CLI) SHALL obtain the identical implementation from the factory.

#### Scenario: CLI and dashboard share one implementation
- **WHEN** a dependent CLI ensures a server entry outside the dashboard
- **THEN** it SHALL use the factory-built service and produce the same file content the dashboard would

### Requirement: HTTP surface for pi MCP config

The plugin SHALL expose routes under its prefix to read the effective view (global or for a known cwd), read the schema, save or remove a server at a scope, and set enabled at a scope. Remove SHALL return the removed raw entry so the caller can restore it exactly. Project-scope routes SHALL apply the known-folder admission check. Server names in the path SHALL be URL-decoded and validated before use. Every route SHALL require the same authentication as every other plugin route and SHALL be registered behind the host's `networkGuard` pre-handler, because writes become executable configuration for pi and the effective view returns credentials.

#### Scenario: Unauthenticated route refused
- **WHEN** a request without valid dashboard authentication reaches any route
- **THEN** it SHALL be refused before any file is read or written

#### Scenario: Remove returns the entry
- **WHEN** a server is removed at global scope
- **THEN** the response SHALL contain the removed entry verbatim

## REMOVED Requirements

### Requirement: Plugin identity and adapter requirement
**Reason**: The adapter is no longer required. **Migration**: See "Plugin identity without an adapter requirement".

### Requirement: Effective configuration is read through the adapter's discovery, never re-implemented
**Reason**: pi's built-in MCP defines discovery. **Migration**: See "Effective configuration follows pi's built-in MCP rules".

### Requirement: Layer model with provenance
**Reason**: Shared/import layers do not exist in pi's built-in MCP. **Migration**: See "Layer provenance uses the Pi vocabulary".

### Requirement: Writes target only Pi-owned layers and are merge-only
**Reason**: pi replaces entries as a whole, so field-level merge semantics no longer apply. **Migration**: See "Writes are atomic, merge-only at the file level, and target one Pi layer".

### Requirement: Disabled flag semantics follow the adapter
**Reason**: pi uses `enabled: false`. **Migration**: See "Enabled flag follows pi".

### Requirement: Global settings are written merge-only
**Reason**: The adapter's global `settings` object has no counterpart in pi's built-in MCP. **Migration**: None.

### Requirement: Configuration schema is published
**Reason**: Schema now describes pi's entry shape. **Migration**: See "Configuration schema is published for pi's entry shape".

### Requirement: Adapter version floor is owned by mcp-client
**Reason**: No adapter. **Migration**: None; the pi floor governs.

### Requirement: In-process service for dependent plugins
**Reason**: Restated without the adapter port and worker thread. **Migration**: See "In-process config service for dependent plugins".

### Requirement: HTTP surface
**Reason**: Global-settings and adapter-verdict routes are removed. **Migration**: See "HTTP surface for pi MCP config".
