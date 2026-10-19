# mcp-client-settings Specification

## Purpose
Global settings surface for managing every MCP server and the adapter's global settings from the dashboard, on any platform, with clear layer provenance and safe editing.

## Requirements

### Requirement: Settings section on the plugin's own page

The plugin SHALL contribute a `settings-section` claim rendered on `/settings/plugins/mcp-client` under host-owned chrome. The claim SHALL NOT set `tab` and no new settings page id SHALL be introduced.

#### Scenario: Section reachable from the plugin row

- **WHEN** the operator opens the settings affordance on the MCP client plugin row
- **THEN** the host navigates to `/settings/plugins/mcp-client`
- **AND** the section renders exactly once

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

### Requirement: Accessibility floor

Every interactive control SHALL have an accessible name, a visible focus ring, and a minimum 44×44px touch target on viewports below 640px. Text contrast SHALL meet WCAG AA using host theme tokens only.

#### Scenario: Mobile touch targets

- **WHEN** the section renders at 390px width
- **THEN** every switch, button, and row action has a 44px minimum hit area

#### Scenario: Keyboard-only editing

- **WHEN** the operator uses only the keyboard
- **THEN** every field, tab, disclosure, and action is reachable and operable in DOM order

### Requirement: Server list with Pi provenance and live state

The section SHALL list every server of the Pi-global layer only, sorted by name; its live state SHALL come from a `pi mcp list --json` run in which no project layer loads. Each row SHALL render as an item card showing the enable switch (accessible name naming the server), name, `description` when set as subtitle, an Edit action, and its metadata as pills: transport (`command` / `url`), exposure, the auth mode for HTTP servers (`auth.provider` name; header when `headers` has `Authorization`; otherwise OAuth, as pi decides), and a provenance pill (**Pi global**). Pi's connection state SHALL be a live status pill with a human word and severity tone: "Connected · N tools" (success) when pi reports the server connected, "Sign-in needed" (warning) when pi reports it needs sign-in, "Not checked by pi" (neutral) when pi did not check it, and "State unknown" (neutral) when no live data is available. Any other pi state SHALL be shown as a human word, never as the raw state enum (for example `needs-auth`). Errors and warnings SHALL use the shared severity tones and SHALL NOT be shown as accent- or palette-coloured text. All existing `mcp-*` data-testids SHALL be preserved.

#### Scenario: Parse error row
- **WHEN** the Pi-global file fails to parse as JSON
- **THEN** the list SHALL show an error row naming the path and the parse error, stating that pi skips the file
- **AND** the row SHALL be a severity-toned notice with the path as code

#### Scenario: Provider-auth server row
- **WHEN** a global HTTP entry has `"auth": { "provider": "radius" }`
- **THEN** its row SHALL show an "auth: radius" pill and SHALL NOT offer an OAuth sign-in hint

#### Scenario: Row shows pi state
- **WHEN** pi reports a server as needing sign-in
- **THEN** its row SHALL show a warning-tone "Sign-in needed" pill with a sign-in hint naming `/mcp login <name>`

#### Scenario: Connected row shows tool count
- **WHEN** pi reports a server connected with 14 tools
- **THEN** its live status pill SHALL read "Connected · 14 tools" in the success tone

#### Scenario: Live state not available
- **WHEN** pi did not check a server, or the live request has not returned data
- **THEN** its live status pill SHALL read "Not checked by pi" or "State unknown" respectively
- **AND** no raw state enum SHALL appear in the row

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

### Requirement: One primary Add server action per state

The section SHALL show exactly one primary-styled "Add server" action in every state. In the empty state it SHALL appear in the empty-state block (testid `mcp-empty-add`) together with the "How MCP configuration works" docs link, and no toolbar "Add server" SHALL be rendered. When servers exist it SHALL appear in the list toolbar (testid `mcp-add-server`) next to a secondary Refresh action. The toolbar heading SHALL name the list and its count (for example "Servers · 3") and SHALL NOT repeat the plugin's display name.

#### Scenario: Empty state
- **WHEN** no Pi-global servers are configured
- **THEN** the section SHALL show the empty-state message with one primary "Add server" action and the docs link
- **AND** no second "Add server" action SHALL be rendered

#### Scenario: Populated state
- **WHEN** three servers are configured
- **THEN** the toolbar SHALL show the heading "Servers · 3", a secondary "Refresh" and one primary "Add server"
- **AND** no other primary action SHALL be rendered in the section outside the editor modal

#### Scenario: Add server opens the editor
- **WHEN** the operator activates the primary "Add server" action in either state
- **THEN** the server editor SHALL open for a new entry
