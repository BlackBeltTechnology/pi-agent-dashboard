## ADDED Requirements

### Requirement: Server list with Pi provenance and live state

The section SHALL list every server from the global effective view, sorted by name. Each row SHALL show name, transport (`command` / `url`), exposure, enabled state, pi's connection state and tool count, and a provenance badge (**Pi global**).

#### Scenario: Row shows pi state
- **WHEN** pi reports a server as needing sign-in
- **THEN** its row SHALL show that state with a sign-in hint naming `/mcp login <name>`

### Requirement: Server editor for pi's entry shape

The editor SHALL render fields from the published schema and SHALL show one transport at a time (`command` or `url`) selected by tabs. `exposure` SHALL be a select, `toolExposure` a key/value list, and any field without a widget SHALL fall back to a validated JSON editor rather than being hidden. Saving SHALL write the complete entry.

#### Scenario: Unknown field is not hidden
- **WHEN** an entry contains a field the editor has no widget for
- **THEN** the field SHALL be shown in the JSON fallback and preserved on save

### Requirement: Secret fields of pi entries are masked

Values of schema-marked secret fields (`oauth.clientSecret`, `headers`, `env`) and any `env` or `headers` key matching a credential pattern (`Authorization`, `*_TOKEN`, `*_KEY`, `*_SECRET`) SHALL render masked with a per-field reveal toggle, and SHALL NOT be written to logs or telemetry. Values of the form `${NAME}` or `!command` SHALL be shown unmasked as references.

#### Scenario: Env reference is not masked
- **WHEN** a header value is `Bearer ${GITHUB_TOKEN}`
- **THEN** it SHALL be shown as written

### Requirement: Unsaved server edits are guarded

Closing the server editor with unsaved changes SHALL ask for confirmation before discarding them.

#### Scenario: Discard confirm
- **WHEN** the operator edits a field and closes the editor
- **THEN** a discard confirmation SHALL be shown

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
