# Spec Delta

## MODIFIED Requirements

### Requirement: Plugin settings bodies compose from the shared settings kit

Every first-party React plugin `settings-section` body SHALL render its editable fields with the shared settings field components exported by `@blackbelt-technology/dashboard-plugin-runtime` (toggle, select, number, text, text area, or the field shell around a custom control such as the model selector), group related fields with the shared settings group, and render callouts with the shared settings notice. A body SHALL NOT render a native checkbox, a native select or a bare input that bypasses those components. A body SHALL paint only through theme tokens: no Tailwind palette class, hex or `rgba(` literal, no `var(--accent-<hue>)` as a text colour, no `--text-muted` / `--text-faint` on readable text, and no font size below 11 px (below 12 px inside an interactive element).

This applies to the plugins `apple-tools`, `automation`, `blackhole`, `browser`, `chat-gateway`, `cost-estimator`, `grammar`, `quota`, `mcp-client`, `system-one`, `obs-studio`, `goal`, `flows` and `subagents`, in addition to those already on the kit. The MCP server editor modal keeps its schema-driven controls and is out of scope. Third-party JSON-Schema descriptor contributions render through the host form (`UiField` / RJSF, see `dashboard-shell-slots`) and are out of scope.

#### Scenario: Every field has an accessible name and description
- **WHEN** any of the listed plugin settings pages renders
- **THEN** every editable control SHALL have an accessible name from a visible label
- **AND** every control that shows a hint SHALL reference it through `aria-describedby`

#### Scenario: Toggles are switches
- **WHEN** a plugin settings body renders a boolean setting
- **THEN** the control SHALL expose `role="switch"` with `aria-checked`
- **AND** no `input[type=checkbox]` SHALL be present in the body outside the MCP server editor modal

#### Scenario: Inputs look editable in every theme
- **WHEN** the Cost page renders in base light, base dark or nord dark
- **THEN** the Seats and Break-after number inputs SHALL have a computed border width of at least 1 px in `--border-secondary` and the `--bg-tertiary` background

#### Scenario: No contrast or size failures
- **WHEN** each listed plugin settings page is rendered in base light, base dark and nord dark and probed with the dashboard's computed-contrast helpers
- **THEN** the contrast, size and focus-indicator failure lists for the plugin body SHALL be empty

### Requirement: Configuration values save through the host Save bar

A plugin settings body SHALL buffer every configuration value it writes through `plugin_config_write` or a plugin config-file route into the host Save bar (a settings-draft source) and SHALL NOT write such a value on each keystroke, on blur, or through its own Save button. A secret that is part of the plugin config (for example the chat-gateway bot token) is a configuration value and follows the draft. Two classes SHALL stay immediate: (a) actions with side effects — saving a secret through a plugin's own route (a browser pairing token, a system-one key, an Electron host token), connect/disconnect, start/stop, running an installer, re-arming, and saving the MCP server editor modal; (b) per-item settings owned by a plugin's own REST route that applies them to one item at once — the browser relay switch (`PUT /api/browser/enabled`), a Chrome profile's zero-dialog and allowed-domains values, and an MCP server row's enable switch. An immediate action SHALL show a busy state while running and, on failure, an error notice scoped to the item it acted on, without blanking the rest of the page. A per-browser preference (the goal plugin's auto-restart default) SHALL stay immediate and SHALL be marked as saved in this browser only.

The chat-gateway, cost-estimator and apple-tools settings bodies SHALL register draft sources `plugin:chat-gateway`, `plugin:cost-estimator` and `plugin:apple-tools`. A blank write-only secret (such as the chat-gateway bot token) SHALL NOT be sent on commit. A typed secret SHALL be cleared from the field and from draft state after commit, on discard and on reset, SHALL NOT be echoed back from the server, and SHALL NOT appear in any "Copy details" text, error notice or log line.

A commit SHALL send only the keys the page edits; the server merges them over the stored plugin config, so keys the page does not own are never overwritten by a stale snapshot. While the page is clean, it SHALL adopt a `plugin_config_update` broadcast for its keys; while dirty, the user's draft values win for edited keys and unedited keys adopt the broadcast. An empty number field SHALL be an invalid draft value, never coerced to 0.

#### Scenario: Commit sends only owned keys
- **WHEN** the apple-tools page commits a changed path while the installer has just written another config key
- **THEN** the commit SHALL send only `imcpServerPath` and the installer's key SHALL survive

#### Scenario: Cost no longer writes per keystroke
- **WHEN** the user types `12` into the Seats field on the Cost page
- **THEN** no configuration write SHALL be sent
- **AND** the host Save bar SHALL show one unsaved change until the user saves or discards

#### Scenario: Discard clears a typed secret
- **WHEN** the user types a new bot token on the chat-gateway page and clicks Discard on the host Save bar
- **THEN** the token field SHALL be empty and no token SHALL be sent

#### Scenario: Secret never reaches Copy details
- **WHEN** saving a chat-gateway config that includes a new bot token fails
- **THEN** the copied details SHALL NOT contain the token value

#### Scenario: Chat-gateway has no in-body Save button
- **WHEN** the chat-gateway settings page renders
- **THEN** it SHALL render no Save button of its own
- **AND** editing any field SHALL mark the host Save bar dirty

#### Scenario: Immediate action failure stays scoped
- **WHEN** saving a pairing token for one Chrome profile fails on the browser settings page
- **THEN** that profile's card SHALL show an error notice with a "Try again" action
- **AND** the other profiles and the relay switch SHALL stay visible and usable

#### Scenario: Goal preference is labelled per-browser
- **WHEN** the goal settings page renders
- **THEN** the auto-restart switch SHALL show that it is saved in this browser only
