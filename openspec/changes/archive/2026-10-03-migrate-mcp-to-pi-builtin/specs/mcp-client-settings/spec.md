## ADDED Requirements

### Requirement: Server list with Pi provenance and live state

The section SHALL list every server of the Pi-global layer only, sorted by name; its live state SHALL come from a `pi mcp list --json` run in which no project layer loads. Each row SHALL show name, `description` when set, transport (`command` / `url`), exposure, enabled state, pi's connection state and tool count, the auth mode for HTTP servers (`auth.provider` name; header when `headers` has `Authorization`; otherwise OAuth, as pi decides), and a provenance badge (**Pi global**).

#### Scenario: Parse error row
- **WHEN** the Pi-global file fails to parse as JSON
- **THEN** the list SHALL show an error row naming the path and the parse error, stating that pi skips the file

#### Scenario: Provider-auth server row
- **WHEN** a global HTTP entry has `"auth": { "provider": "radius" }`
- **THEN** its row SHALL show "auth: radius" and SHALL NOT offer an OAuth sign-in hint

#### Scenario: Row shows pi state
- **WHEN** pi reports a server as needing sign-in
- **THEN** its row SHALL show that state with a sign-in hint naming `/mcp login <name>`

### Requirement: Server editor for pi's entry shape

The editor SHALL render fields from the published schema and SHALL show one transport at a time (`command` or `url`) selected by tabs. `exposure` SHALL be a select, `toolExposure` a key/value list, and any field without a widget SHALL fall back to a validated JSON editor rather than being hidden. Saving SHALL write the complete entry.

#### Scenario: Unknown field is not hidden
- **WHEN** an entry contains a field the editor has no widget for
- **THEN** the field SHALL be shown in the JSON fallback and preserved on save

### Requirement: Secret fields of pi entries are masked

Values of schema-marked secret fields (`oauth.clientSecret`, `headers`, `env`) and any `env` or `headers` key matching a credential pattern (`Authorization`, `*_TOKEN`, `*_KEY`, `*_SECRET`) SHALL render masked with a per-field reveal toggle, and SHALL NOT be written to logs or telemetry. Values that contain a `${NAME}` reference or start with `!` (a command) SHALL be shown unmasked as written.

#### Scenario: Env reference is not masked
- **WHEN** a header value is `Bearer ${GITHUB_TOKEN}`
- **THEN** it SHALL be shown as written

### Requirement: Unsaved server edits are guarded

Closing the server editor with unsaved changes SHALL ask for confirmation before discarding them.

#### Scenario: Discard confirm
- **WHEN** the operator edits a field and closes the editor
- **THEN** a discard confirmation SHALL be shown

## MODIFIED Requirements

### Requirement: Enable/disable from the row

Toggling a row's switch SHALL write pi's `enabled` flag at global scope (`enabled: false` to disable, the key removed to enable) and reflect the persisted result, reverting on failure.

#### Scenario: Toggle persists

- **WHEN** the operator switches a Pi-global server off
- **THEN** the switch shows pending until the write completes
- **AND** on success the row reads disabled and the entry carries `enabled: false`

#### Scenario: Toggle failure reverts

- **WHEN** the write fails
- **THEN** the switch returns to its previous state
- **AND** an error is shown inline on the row

## REMOVED Requirements

### Requirement: Adapter status drives a single read-only state
**Reason**: No adapter verdict exists. **Migration**: The section is always editable; pi connection state is shown per row.

### Requirement: Server list with provenance
**Reason**: Shared/Other provenance no longer exists. **Migration**: See "Server list with Pi provenance and live state".

### Requirement: Overriding a shared server
**Reason**: No shared layer in pi's built-in MCP. **Migration**: None.

### Requirement: Server editor
**Reason**: Adapter fields (`socket`, `lifecycle`, `directTools`, …) are replaced by pi's fields. **Migration**: See "Server editor for pi's entry shape".

### Requirement: Secret fields are masked
**Reason**: Secret field list follows pi's shape. **Migration**: See "Secret fields of pi entries are masked".

### Requirement: Global settings form
**Reason**: No adapter global settings. **Migration**: None.

### Requirement: Dashboard plugin settings group
**Reason**: `adapterLoadTimeoutMs` bounded the adapter worker, which is removed. **Migration**: None.

### Requirement: Unsaved edits are guarded
**Reason**: The settings form it guarded is removed. **Migration**: See "Unsaved server edits are guarded".
