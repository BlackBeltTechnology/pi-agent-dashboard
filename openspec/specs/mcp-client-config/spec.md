# mcp-client-config Specification

## Purpose
Server-side ownership of `pi-mcp-adapter` configuration on the dashboard: reads the adapter's full layer stack, writes only the two Pi-owned layers, and exposes that capability to other plugins as an in-process service.

## Requirements

### Requirement: Project-scope writes validate the directory

A project-scope write SHALL be refused unless the supplied directory is in the host's known folder set after canonicalisation. The directory value SHALL be treated as untrusted input. The admission function SHALL be the one shared implementation used by the kb plugin — the whole admission module (`isAllowedCwd`, `canonPath`, and the git main-checkout resolution that admits a worktree whose main checkout is known) — extracted into the shared package so both plugins import it rather than each carrying a copy. A worktree cwd whose main checkout is a known folder is admitted, as for kb.

#### Scenario: Worktree of a known folder is admitted

- **WHEN** a project-scope write names a git worktree whose main checkout is in the known folder set
- **THEN** the write is admitted and lands in that worktree's `.pi/mcp.json`

#### Scenario: Unknown directory is refused

- **WHEN** a project-scope write names a directory outside the host's known folder set
- **THEN** no filesystem write occurs
- **AND** the caller receives a not-allowed error

#### Scenario: Path traversal in the directory is refused

- **WHEN** the supplied directory resolves outside every known folder after normalisation
- **THEN** no filesystem write occurs

### Requirement: Plugin is registered for production bundling

The plugin SHALL be registered wherever first-party plugins are enumerated for production builds so it is present in the web bundle and the desktop bundle.

#### Scenario: Production build includes the plugin

- **WHEN** the client is built for production
- **THEN** the `mcp-client` settings section and folder pill are available without a dev-server

### Requirement: Plugin identity without an adapter requirement

The dashboard SHALL ship the first-party plugin `mcp-client` (npm `@blackbelt-technology/pi-dashboard-mcp-client-plugin`) as the manager of pi's built-in MCP configuration. No first-party plugin SHALL declare `pi-mcp-adapter` as a required pi extension or package dependency.

#### Scenario: No adapter requirement
- **WHEN** the plugins index is read
- **THEN** no plugin SHALL list `pi-mcp-adapter` under its requirements

### Requirement: Effective configuration follows pi's built-in MCP rules

The plugin SHALL compute the effective MCP configuration for a directory from exactly two layers: the Pi-global `~/.pi/agent/mcp.json` (honouring `PI_CODING_AGENT_DIR`) and, only when pi trusts the project, `<cwd>/.pi/mcp.json`. Project trust SHALL come from an injected boolean trust predicate that applies the `pi-trust-mirror` folder decision, resolving pi's agent directory as pi does (honouring `PI_CODING_AGENT_DIR`); an optional injected accessor SHALL report the source of the decision, and the effective view SHALL expose that source additively (absent accessor → source omitted). Without a predicate, every project SHALL count as untrusted, and a predicate that cannot be built at boot SHALL be logged rather than silently degrade to untrusted. A project entry for which `command`, `url` or `type` is not `undefined` SHALL replace the global entry of the same name as a whole. A project entry for which all three are `undefined` is a **project override**, as in pi ≥ 1.0.1. Its base SHALL be the global entry of the same name only when pi keeps that entry — valid and not dropped as a name collision; with no such base the override SHALL be reported as a folder row with pi's message `needs "command" or "url", or a global server to override`. An override with a key other than `enabled`, `exposure` and `toolExposure` SHALL be reported as a folder row with pi's message `an override can only set enabled, exposure, toolExposure`. Otherwise its effect SHALL be the base with those keys replaced (`{ ...base, ...override }`), validated with pi's entry rules (a failure reported as a folder row with pi's message), and it SHALL be exempt from the namespace-collision and project-`auth` checks, because the merged entry inherits the global one. A valid override SHALL be reported as the global server's single row carrying the merged entry (redacted like any global row in a project view) and the override's path and keys. Whenever an override is reported as a folder row, the global entry SHALL stay in effect unchanged. Connection state and tool counts SHALL come from pi (`pi mcp list --json`) rather than being re-implemented; it SHALL run with a 30-second timeout and its result SHALL be cached per cwd for 30 seconds; its stdout SHALL be parsed whatever its exit code, and state SHALL be reported unknown only when the command cannot run, times out, or prints unparseable output; for a project trusted only through dashboard trust, project-layer servers SHALL instead be reported with live state "not checked by pi", because that command reads only pi's own trust store and accepts no approve flag. Each layer SHALL be parsed as strict JSON, as pi parses it; a layer that fails to parse SHALL be reported per layer, as skipped by pi, without hiding the other layer. Entry keys pi ignores (adapter-only keys such as `disabled`, `directTools`, `lifecycle`) SHALL be reported as ignored by pi.

#### Scenario: Non-zero exit still yields state
- **WHEN** `pi mcp list --json` exits `1` because one server is not connected and prints valid JSON
- **THEN** every server SHALL show pi's reported state, the disconnected one included

#### Scenario: Adapter disabled key is flagged
- **WHEN** a global entry carries `disabled: true` and no `enabled` key
- **THEN** the view SHALL report the entry as enabled under pi with `disabled` ignored, and offer converting it to `enabled: false`

#### Scenario: Project entry replaces global
- **WHEN** both layers define `docs` with a `url` or `command` and the project is trusted
- **THEN** the effective `docs` entry SHALL be exactly the project entry, with no fields inherited from the global entry

#### Scenario: Untrusted project layer is inactive
- **WHEN** `<cwd>/.pi/mcp.json` exists but pi does not trust the project
- **THEN** its servers SHALL be reported as inactive with the reason "project not trusted"

#### Scenario: Project override merges onto the global entry
- **WHEN** the global `docs` entry has a URL and an `Authorization` header and the trusted project has `"docs": { "enabled": false }`
- **THEN** the effective view SHALL show one `docs` row with provenance Pi global, `enabled: false`, the global URL and the header redacted, and a project-override marker naming `enabled`

#### Scenario: Override without a global server
- **WHEN** the trusted project has `"ghost": { "enabled": false }` and no global `ghost` exists
- **THEN** a folder row `ghost` SHALL be reported inactive with pi's message `needs "command" or "url", or a global server to override`

#### Scenario: Override of an invalid global entry
- **WHEN** the global `docs` entry is invalid under pi's rules (for example `exposure: "bogus"`) and the trusted project has `"docs": { "exposure": "direct" }`
- **THEN** the folder row `docs` SHALL be reported inactive with pi's message `needs "command" or "url", or a global server to override`
- **AND** no `docs` row SHALL be reported active

#### Scenario: Override with a non-override key
- **WHEN** the trusted project has `"docs": { "enabled": false, "timeout": 5 }` and no `command`, `url` or `type`
- **THEN** a folder row `docs` SHALL be reported inactive with pi's message `an override can only set enabled, exposure, toolExposure`
- **AND** the global `docs` row SHALL stay in effect unchanged

#### Scenario: A null transport key is not an override
- **WHEN** the trusted project has `"docs": { "url": null, "enabled": false }`
- **THEN** the entry SHALL be treated as a whole-entry replace and reported with pi's validation message

#### Scenario: Override in an untrusted project
- **WHEN** `<cwd>/.pi/mcp.json` has `"docs": { "enabled": false }` and pi does not trust the project
- **THEN** the global `docs` row SHALL stay enabled and the override SHALL be reported as an inactive folder row with the reason "project not trusted"

#### Scenario: Dashboard-trusted project layer is active
- **WHEN** `<cwd>/.pi/mcp.json` exists, `trust.json` records nothing for `<cwd>`, and dashboard trust covers `<cwd>`
- **THEN** its servers SHALL be reported active and the view SHALL carry the dashboard source as the trust source

#### Scenario: Unbuildable predicate is logged
- **WHEN** pi's trust classes cannot be resolved at server boot
- **THEN** the server SHALL log that every project reads untrusted, once

#### Scenario: Live state for a dashboard-trusted folder
- **WHEN** the project is trusted only through dashboard trust and its view is requested
- **THEN** the project servers SHALL be reported active with live state "not checked by pi", not as disconnected
- **AND** running `pi mcp list` in that folder outside the dashboard still reports them as not loaded, which the view SHALL state

### Requirement: Layer provenance uses the Pi vocabulary

Every server in an effective view SHALL carry provenance **Pi global** or **Pi folder**, and a folder entry that replaces a global one SHALL be marked as overriding it. A valid project override (no `command`, `url` or `type`) SHALL NOT create a Pi folder row: the global server's row SHALL keep provenance Pi global and SHALL be marked with the overridden keys and the folder file path.

#### Scenario: Folder override is marked
- **WHEN** a trusted folder defines, with a `url` or `command`, a server that also exists globally
- **THEN** the view SHALL show it as Pi folder, overriding Pi global

#### Scenario: Project override keeps Pi global provenance
- **WHEN** a trusted folder has `"docs": { "exposure": "direct" }` and `docs` exists globally
- **THEN** the view SHALL show one `docs` row with provenance Pi global marked as overridden in this folder (`exposure`)

### Requirement: Writes are atomic, merge-only at the file level, and target one Pi layer

Every write SHALL target exactly one Pi layer (`global` → the Pi-global file, `project` → `<cwd>/.pi/mcp.json`). It SHALL replace or delete exactly one `mcpServers.<name>` entry, preserve every other entry and unrecognised key, write atomically, and refuse to write over an unparseable file. Server names SHALL be restricted to letters, digits, `_` and `-`, and SHALL NOT differ only in `-` versus `_` from another server other than the entry being replaced (at project scope: a server of that cwd's effective view; at global scope: an entry of the global file or a whole-entry (non-override) entry of a known folder's trusted project layer, because pi would then drop that folder entry; project overrides are never collision-checked, as in pi) (pi ≥ 0.99.2 maps both to one `mcp__<name>__` namespace and rejects the pair). An HTTP entry carrying `auth` SHALL be refused at project scope (pi reads `auth.provider` only from the global file and extensions). Refusals SHALL be reported as a closed set (`unparseable`, `entry-not-object`, `invalid-name`, `name-collision`, `transport-conflict`, `invalid-entry`, `no-global-server`, `write-failed` carrying the IO error code), shared by the service's write and check operations. Server names `__proto__`, `constructor` and `prototype` SHALL be refused at every entry point. A project override SHALL be written only by the project-override operation, which SHALL validate the merged entry as pi does and SHALL refuse with `no-global-server` when pi keeps no global entry of that name; a whole-entry save of an override-shaped entry at project scope SHALL be refused as `invalid-entry`. A write SHALL be refused when pi's entry validation would reject the entry (transport `type`, `url` scheme, string-valued `headers` / `env`, positive `timeout`, `oauth` field shapes, https-or-loopback URL for `auth`).

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

#### Scenario: Global write does not collide with a folder override
- **WHEN** a known trusted folder's `.pi/mcp.json` has the override `"dev-radius": { "enabled": false }` and a global write adds `dev_radius`
- **THEN** the global write SHALL NOT be refused because of that override

#### Scenario: Override write without a global server refused
- **WHEN** a project-override write names a server pi keeps no global entry for
- **THEN** the write SHALL be refused with code `no-global-server` and no file SHALL change

### Requirement: Enabled flag follows pi

Disabling a server SHALL write `enabled: false` on its entry in the chosen layer; enabling SHALL remove the `enabled` key. Setting enabled at project scope for a server whose effective entry comes from the global layer (with or without a project override) SHALL write only the project override, read-modify-write: it SHALL set the override's `enabled` key only when the requested state differs from the global entry's (`false` to turn off a globally enabled server, `true` to turn on a globally disabled one), SHALL otherwise delete that key, SHALL preserve the override's other keys, and SHALL delete the override entry when no key remains. When there is no override and the requested state equals the effective state, no file SHALL be created or written. No global field, secret or otherwise, SHALL be written to the project layer by this path. For a project entry that replaces the global one as a whole, disabling SHALL write `enabled: false` on it and enabling SHALL remove the key, as at global scope. Enabling a whole-entry project copy that lacks secret-bearing values (`headers`, `env`, `oauth.clientSecret`) present in the global entry SHALL offer removing the project entry, re-entering the omitted values, or converting it to a project override when it is a legacy copy.

#### Scenario: Disable a global-only server in a folder
- **WHEN** a global server with an `Authorization` header is disabled from a trusted folder
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain exactly `"<name>": { "enabled": false }` for that server and no header, URL or other global field

#### Scenario: Re-enable a server disabled only in the folder
- **WHEN** the global server is enabled, the folder override is `{ "enabled": false }`, and the operator turns it on from the folder
- **THEN** the override's `enabled` key SHALL be deleted, and the override entry SHALL be removed because no key remains

#### Scenario: Turn on a globally disabled server for one folder
- **WHEN** the global entry has `enabled: false` and the operator turns it on from a trusted folder
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain `"<name>": { "enabled": true }`

#### Scenario: Other override keys survive a toggle
- **WHEN** the folder override is `{ "enabled": false, "exposure": "direct" }` and the operator turns the globally enabled server on
- **THEN** the override SHALL become `{ "exposure": "direct" }`

#### Scenario: A no-op toggle creates no file
- **WHEN** a folder has no `.pi/mcp.json` and the operator turns on a globally enabled server
- **THEN** no file SHALL be created

### Requirement: Configuration schema is published for pi's entry shape

The plugin SHALL publish a JSON Schema for pi's MCP server entry: stdio (`command`, `args`, `env`, `cwd`) or HTTP (`url`, `headers`, `oauth` with `clientId`, `clientSecret`, `callbackPort`, `callbackUrl`, `scope`, `clientName`, `authServerMetadataUrl`, and `auth` with `provider`), plus `type`, `description`, `exposure` (`direct`, `codemode`, `deferred`, `hidden`; `codemode-deferred` accepted on read as pi's alias of `codemode` and preserved unless the user changes exposure), `toolExposure`, `timeout` and `enabled`. It SHALL mark secret fields and the transport exclusivity (`command` xor `url`) so clients render editors without hard-coded field lists. It SHALL also publish a `ProjectOverride` definition allowing only `enabled`, `exposure` and `toolExposure` (no additional properties); a project-override write SHALL be validated against it, every other write against the server-entry definition.

#### Scenario: Legacy exposure alias preserved
- **WHEN** an entry has `exposure: "codemode-deferred"` and the user edits only its `description`
- **THEN** the saved entry SHALL keep `exposure: "codemode-deferred"` and the editor SHALL show it as `codemode`

#### Scenario: Both transports rejected
- **WHEN** a write would leave an entry with both `command` and `url`
- **THEN** the write SHALL be refused naming the transport conflict

#### Scenario: Existing dual-transport entry read as HTTP
- **WHEN** a file entry already has both `command` and `url`
- **THEN** the view SHALL show it with the transport pi picks (HTTP unless `type` is `stdio`) and flag the other key as ignored

#### Scenario: Override write with a secret key refused
- **WHEN** a project-override write carries `headers`
- **THEN** the write SHALL be refused before any file is written

#### Scenario: Override shape refused at global scope
- **WHEN** a global-layer write carries an entry with no `command`, `url` or `type`
- **THEN** the write SHALL be refused as an invalid entry

### Requirement: In-process config service for dependent plugins

The plugin SHALL expose an `mcp-client.config` service, built by an exported factory taking injected file IO, the known-cwd set and an optional project-trust predicate, offering read effective view, ensure/remove server entry, set enabled, set project override, convert a legacy folder copy, and check-config-files. Existing operations SHALL keep their signatures, so dependents that only use global scope are unaffected. A hostless process (a dependent plugin's CLI) SHALL obtain the identical implementation from the factory.

#### Scenario: CLI and dashboard share one implementation
- **WHEN** a dependent CLI ensures a server entry outside the dashboard
- **THEN** it SHALL use the factory-built service and produce the same file content the dashboard would

### Requirement: HTTP surface for pi MCP config

The plugin SHALL expose routes under its prefix to read the effective view (global or for a known cwd), read the schema, save or remove a server at a scope, set enabled at a scope, set a project override (`PUT …/servers/:name/project-override`, project scope only; body fields `enabled`, `exposure` and `toolExposure` (including each `toolExposure` value, pi's exposure aliases accepted) validated by type and enum before the scope is parsed, where an absent field is unchanged and `null` deletes the key; the response carries the written override or `removed: true`), and convert a legacy folder copy (`POST …/servers/:name/convert-to-override`, project scope only; the response carries the previous raw entry). Remove SHALL return the removed raw entry so the caller can restore it exactly. Project-scope routes SHALL apply the known-folder admission check. Server names in the path SHALL be URL-decoded and validated before use. Every route SHALL require the same authentication as every other plugin route and SHALL be registered behind the host's `networkGuard` pre-handler, because writes become executable configuration for pi and the effective view returns credentials.

#### Scenario: Unauthenticated route refused
- **WHEN** a request without valid dashboard authentication reaches any route
- **THEN** it SHALL be refused before any file is read or written

#### Scenario: Remove returns the entry
- **WHEN** a server is removed at global scope
- **THEN** the response SHALL contain the removed entry verbatim

#### Scenario: Project override route requires a project scope
- **WHEN** `PUT …/servers/docs/project-override` is called without a known-folder `cwd`
- **THEN** it SHALL be refused and no file SHALL be written

#### Scenario: Project override route refuses a missing global server
- **WHEN** the route is called for a name pi keeps no global entry for
- **THEN** it SHALL be refused with code `no-global-server`

#### Scenario: Project override route validates the body first
- **WHEN** the route receives `enabled: "no"` or `exposure: "bogus"`
- **THEN** it SHALL be refused before the scope is parsed or any file is read

#### Scenario: Restoring an override is exact
- **WHEN** an override `{ "enabled": false, "toolExposure": { "search": "direct" } }` is removed and its raw keys are PUT back with absent keys as `null`
- **THEN** the folder file SHALL contain the identical override
