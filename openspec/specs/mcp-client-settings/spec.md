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

### Requirement: Adapter status drives a single read-only state

The section SHALL derive one adapter status from the adapter verdict and use it for the header status pill, any banner, and a page-wide read-only flag. When the verdict is not `ok`, every mutating control (enable/disable switches, Add server, editor Save, settings Save) SHALL be disabled and the editor SHALL open in view mode.

#### Scenario: Below-floor adapter locks the page

- **WHEN** the verdict is `below-floor`
- **THEN** the header pill and the banner report the same installed version and floor
- **AND** the banner offers an upgrade action
- **AND** all switches and Save controls are disabled

#### Scenario: Absent adapter locks the page

- **WHEN** the verdict is `absent`
- **THEN** the banner offers the install action
- **AND** the server list still renders read-only so existing config is visible

#### Scenario: Status pill and banner never disagree

- **WHEN** the verdict changes after an install or upgrade completes
- **THEN** pill, banner, and read-only flag update together in one render

### Requirement: Server list with provenance

The section SHALL list every server from the global effective view. Each row SHALL show name, transport (`command` / `url` / `socket`), enabled state, and a provenance badge naming the defining source using the vocabulary **Shared** (read-only, lock icon), **Pi global**, **Other** (read-only, names the source kind, no View/Override action). Rows SHALL be sorted by name.

#### Scenario: Shared server renders read-only

- **WHEN** a server is defined only in a shared layer
- **THEN** its row shows the Shared badge with a lock
- **AND** its enable switch is disabled
- **AND** its action is "View", not "Edit"

#### Scenario: Pi-global server is editable

- **WHEN** a server is defined in `~/.pi/agent/mcp.json`
- **THEN** its row shows the Pi global badge
- **AND** its enable switch and Edit action are active (subject to the read-only flag)

#### Scenario: Parse error row

- **WHEN** a layer failed to parse
- **THEN** the list shows an error row naming the path and the parse error
- **AND** servers from other layers still render

#### Scenario: Empty list

- **WHEN** no layer defines any server
- **THEN** the list shows an empty state with an Add server action and a documentation link

#### Scenario: Loading state

- **WHEN** the effective view has not yet arrived
- **THEN** skeleton rows render in place of the list

### Requirement: Enable/disable from the row

Toggling a row's switch SHALL write the disabled flag at global scope and reflect the persisted result, reverting on failure.

#### Scenario: Toggle persists

- **WHEN** the operator switches a Pi-global server off
- **THEN** the switch shows pending until the write completes
- **AND** on success the row reads disabled

#### Scenario: Toggle failure reverts

- **WHEN** the write fails
- **THEN** the switch returns to its previous state
- **AND** an error is shown inline on the row

### Requirement: Overriding a shared server

A shared server SHALL offer an "Override at Pi global" action that opens the editor showing the effective values, every field marked as inherited. Saving SHALL send a patch containing only the fields the operator changed, so only those land in `~/.pi/agent/mcp.json` under the same server name; inherited values SHALL never be sent. Overriding an inherited layer-atomic object field (`env`, `headers`, `searchKeywords`, `oauth`, `requestHeadersCommand`, per the schema marker) SHALL be an explicit action that starts from an empty object and states how many inherited keys and secrets will stop applying, because the adapter replaces records wholesale across layers.

#### Scenario: Override writes only changed fields

- **WHEN** the operator overrides a shared server and changes one field
- **THEN** `~/.pi/agent/mcp.json` gains an entry for that server containing only that field
- **AND** the row's provenance now lists both layers

### Requirement: Server editor

The editor SHALL render fields from the published schema, including union-typed fields (`boolean | string[]` as a toggle-with-list) and nested object fields (as a nested group); any field the renderer has no widget for SHALL fall back to a validated JSON editor rather than being hidden. It SHALL show one transport at a time (`command`, `url`, or `socket`) selected by tabs, with the other transports' fields hidden; the tab initially selected is the transport the layer entry defines, else the effective one. It SHALL group rarely-used fields under an Advanced disclosure. Validation errors SHALL appear inline at the field and as a summary at the top on Save. The editor (a modal / bottom sheet) SHALL have exactly one primary action, Save, which commits that server's patch immediately; the editor is not a draft source.

#### Scenario: Transport tabs hide the other transport

- **WHEN** the `url` tab is selected
- **THEN** `command`/`args`/`env` and `socket` fields are hidden
- **AND** `url`/`headers`/`auth` fields are shown

#### Scenario: Invalid save shows errors

- **WHEN** Save is pressed with an empty `command` on the command transport
- **THEN** the field shows an inline error
- **AND** a summary at the top lists the error
- **AND** no write occurs

#### Scenario: Read-only editor for shared servers

- **WHEN** the editor opens for a shared server via View
- **THEN** fields render as text, not inputs
- **AND** the footer offers "Override at Pi global" instead of Save

#### Scenario: Unknown fields survive editing

- **WHEN** the server being edited has a field not in the schema
- **THEN** saving preserves that field

### Requirement: Secret fields are masked

Values of schema-marked secret fields (`bearerToken`, `oauth.clientSecret`, `headers`, `env`, `requestHeadersCommand.env`), and any `env` or `headers` key matching a credential pattern (`Authorization`, `*_TOKEN`, `*_KEY`, `*_SECRET`), SHALL render masked with a per-field reveal toggle. Masked values SHALL NOT be written to logs or telemetry.

#### Scenario: Token masked by default

- **WHEN** the editor shows `headers.Authorization`
- **THEN** the value renders as bullets
- **AND** a reveal toggle exposes it on demand

#### Scenario: Reveal is per-field and per-session

- **WHEN** the operator reveals one secret and reopens the editor
- **THEN** all secrets are masked again

#### Scenario: Inherited secrets cannot be revealed

- **WHEN** the editor shows a secret field that is inherited from a layer other than the one being edited
- **THEN** the value renders as a redaction placeholder with no reveal toggle (the server never sent the value)
- **AND** the field is not included in any patch unless the operator types a new value

### Requirement: Global settings form

The section SHALL render the adapter's global settings (the `settings` object) from the schema, showing, for any key the Pi-global file does not set, the effective fallback value labelled either with the lower layer that defines it or as the adapter default, as a host draft source: the section SHALL register with the host settings draft context under `plugin:mcp-client` (`isDirty`, `commit`, `reset`), so the host's dirty-gated Save Bar, dirty indicators, rail guard and `beforeunload` apply; it SHALL NOT render a Save button of its own. Committing SHALL send a patch of only changed keys; clearing a field SHALL unset its key. The section SHALL state that comments in the config file are not preserved on save.

#### Scenario: Unset value shows default

- **WHEN** a global setting is not present in any layer
- **THEN** the form shows the adapter default marked as default

#### Scenario: Unset value inherited from a lower layer

- **WHEN** a global setting is absent from the Pi-global file but defined in a shared layer
- **THEN** the form shows the shared value labelled with that layer
- **AND** the clear action is described as "use inherited", not "reset to default"

#### Scenario: Save writes only changed keys

- **WHEN** one setting is changed and saved
- **THEN** only that key changes in `~/.pi/agent/mcp.json`

### Requirement: Dashboard plugin settings group

The section SHALL render, below the adapter's global settings form and visually separated from it, a "Dashboard plugin settings" group for the plugin's own host config (`plugins.mcp-client`, per the manifest `configSchema`), currently one field: `adapterLoadTimeoutMs` (number input, default `10000`, range `1000`–`120000`, help text stating it bounds how long the dashboard waits for the adapter to load configuration and does not affect pi sessions). The group SHALL belong to the same `plugin:mcp-client` draft source: `commit` SHALL write the plugin config through the host plugin-config path and the adapter settings patch, awaiting both; if either rejects, the source SHALL stay dirty and the error SHALL be shown on the failing group. Out-of-range values SHALL be flagged inline before commit.

#### Scenario: Timeout saved through the host Save Bar

- **WHEN** the operator sets `adapterLoadTimeoutMs` to `2500` and activates the host Save
- **THEN** a plugin-config write for `plugins.mcp-client` carrying `{ adapterLoadTimeoutMs: 2500 }` is issued
- **AND** no adapter `settings` patch is issued (nothing else changed)
- **AND** `~/.pi/agent/mcp.json` is unmodified

#### Scenario: Out-of-range timeout is flagged before commit

- **WHEN** the operator enters `500`
- **THEN** the field shows an inline range error
- **AND** the host Save is refused for this source until corrected

#### Scenario: One group failing keeps the source dirty

- **WHEN** both a timeout change and an adapter setting change are committed and the adapter settings write is refused (unparseable target)
- **THEN** the plugin-config write has landed
- **AND** the source reports dirty with the error shown on the adapter settings group

#### Scenario: Timeout surfaced on the list

- **WHEN** the effective view request returns `504 adapter-timeout`
- **THEN** the list shows an error state naming the timeout value with a retry action and a link to the timeout field

### Requirement: Unsaved edits are guarded

Unsaved settings-form edits SHALL be visible to the host through the registered draft source, so the host Save Bar appears and leaving the page with unsaved edits follows the host settings-panel discard-confirm contract. No section-local footer or Save button is rendered.

#### Scenario: Route change with unsaved edits prompts

- **WHEN** the operator navigates away with unsaved settings-form edits
- **THEN** the host discard-confirm appears (the draft source reports dirty)
- **AND** cancelling keeps the edits

#### Scenario: Host Save Bar commits the settings patch

- **WHEN** one global setting is changed and the host Save Bar's Save is activated
- **THEN** the section's `commit` sends a patch containing only that key
- **AND** the draft source reports clean afterwards

### Requirement: Accessibility floor

Every interactive control SHALL have an accessible name, a visible focus ring, and a minimum 44×44px touch target on viewports below 640px. Text contrast SHALL meet WCAG AA using host theme tokens only.

#### Scenario: Mobile touch targets

- **WHEN** the section renders at 390px width
- **THEN** every switch, button, and row action has a 44px minimum hit area

#### Scenario: Keyboard-only editing

- **WHEN** the operator uses only the keyboard
- **THEN** every field, tab, disclosure, and action is reachable and operable in DOM order
