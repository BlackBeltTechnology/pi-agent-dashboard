# plugin-config-persistence Specification

## Purpose
TBD - created by archiving change fix-plugin-config-write-persistence. Update Purpose after archive.
## Requirements
### Requirement: plugin_config_write is a first-class browser-protocol message

The browser→server protocol union SHALL include a `plugin_config_write` message of shape `{ type: "plugin_config_write"; id: string; config: Record<string, unknown> }`. Plugin settings sections SHALL send it via `usePluginSend` without a type cast.

#### Scenario: Message is type-checked
- **WHEN** a plugin calls `send({ type: "plugin_config_write", id, config })`
- **THEN** the call SHALL type-check against the browser-protocol union without an `as never` cast

### Requirement: plugin_config_write is routed to the canonical config route

The shell-provided plugin `send` (wired into `PluginContextProvider`) SHALL intercept `plugin_config_write { id, config }` and persist it by issuing `POST /api/config/plugins/:id` with `config` as the JSON body, instead of forwarding the message over the raw WebSocket. All other message types SHALL pass through unchanged to the existing transport.

#### Scenario: Config write becomes a POST
- **WHEN** the plugin `send` receives `{ type: "plugin_config_write", id: "flows", config: { editFlow: true } }`
- **THEN** it SHALL issue `POST /api/config/plugins/flows` with body `{ editFlow: true }`
- **AND** it SHALL NOT send a `plugin_config_write` frame over the WebSocket

#### Scenario: Non-config messages are unaffected
- **WHEN** the plugin `send` receives any message whose `type` is not `plugin_config_write`
- **THEN** it SHALL forward the message via the existing WebSocket transport unchanged

### Requirement: Persisted config round-trips and clears the draft-dirty state

A successful `POST /api/config/plugins/:id` SHALL persist the merged config to `~/.pi/dashboard/config.json#plugins[id]` and broadcast `plugin_config_update { id, config }`. The client SHALL apply that broadcast to the plugin config store so `usePluginConfig` consumers re-render with the new value, which makes the settings section's `isDirty` become false and the host's unsaved-change count decrement.

#### Scenario: Save clears the unsaved indicator
- **WHEN** a user toggles a plugin setting and clicks Save and the POST returns 200
- **THEN** `~/.pi/dashboard/config.json#plugins[id]` SHALL contain the new value
- **AND** the broadcast `plugin_config_update` SHALL update the client store
- **AND** the settings section SHALL report `isDirty: false` (the unsaved-change count drops)

#### Scenario: Value survives reload
- **WHEN** the dashboard reloads after a successful save
- **THEN** `usePluginConfig` for that plugin SHALL return the persisted value

### Requirement: Client hydrates plugin configs from persisted config on boot

The persist + broadcast path only updates live clients on write. On a fresh page load there is no broadcast, so the client SHALL seed the in-memory plugin-config store from the persisted config returned by `GET /api/config` (`data.plugins`). The boot `/api/config` fetch SHALL call `initPluginConfigs(data.plugins)`, and `initPluginConfigs` SHALL notify already-subscribed `usePluginConfig` consumers (the fetch resolves in a post-render effect, after consumers have read the empty initial value). Without this seed, every reload resets plugin settings to schema defaults regardless of what is on disk.

#### Scenario: Plugin config store seeded on reload
- **WHEN** the client boots and `GET /api/config` returns `data.plugins.flows = { enabled: true, editFlow: true }`
- **THEN** `initPluginConfigs` SHALL be called with the `data.plugins` block
- **AND** `usePluginConfig` for `flows` SHALL return `editFlow: true` (not the schema default)

#### Scenario: Late seed notifies mounted consumers
- **WHEN** a `usePluginConfig` consumer mounts and reads an empty config, then `initPluginConfigs` runs with a non-empty block for that plugin
- **THEN** the mounted consumer SHALL re-render with the seeded value (subscriber notified, not a silent Map write)

### Requirement: commit awaits the write and rejects on failure

The settings section's `commit()` SHALL await the config write and SHALL reject when the route returns a non-2xx status (e.g. 404 unknown plugin, 409 disabled, 400 schema-invalid). A rejected `commit()` SHALL leave the draft dirty (so the host shows the error and allows retry) per the `SettingsDraftSource` contract.

#### Scenario: Schema-invalid write keeps the draft dirty
- **WHEN** `POST /api/config/plugins/:id` returns 400 (config fails `configSchema` validation)
- **THEN** `commit()` SHALL reject
- **AND** the host SHALL NOT show "Settings saved" and the draft SHALL remain dirty

#### Scenario: Disabled plugin write is rejected
- **WHEN** a write targets a disabled plugin and the route returns 409
- **THEN** `commit()` SHALL reject and the draft SHALL remain dirty

### Requirement: Any plugin is auto-handled with no per-plugin wiring

The persistence path SHALL be generic by plugin `id`. Adding a new plugin with a `settings-section` claim (and optional `configSchema`) SHALL make its settings persist with NO new client interception code, NO new server handler, and NO per-plugin registration. The route SHALL resolve the plugin's `configSchema` by discovery at request time.

#### Scenario: New plugin persists without code changes
- **WHEN** a new plugin declares a `settings-section` claim and a `configSchema`, and its settings section sends `plugin_config_write`
- **THEN** its config SHALL validate against that schema and persist via the same interception + route, with no code added for that plugin

#### Scenario: Schema-less plugin still persists
- **WHEN** a plugin without a `configSchema` sends `plugin_config_write`
- **THEN** the route SHALL skip validation and still persist + broadcast the merged config

