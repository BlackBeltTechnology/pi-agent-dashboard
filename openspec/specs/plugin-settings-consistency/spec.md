# plugin-settings-consistency Specification

## Purpose
Rules every plugin settings body on `/settings/plugins/<id>` follows so sibling pages share one field anatomy, one status vocabulary and one save model, and a ratchet lint keeps them from drifting.

## Requirements

### Requirement: Plugin settings bodies compose from the shared settings kit

Every first-party React plugin `settings-section` body SHALL render its editable fields with the shared settings field components exported by `@blackbelt-technology/dashboard-plugin-runtime` (toggle, select, number, text, text area, or the field shell around a custom control such as the model selector), group related fields with the shared settings group, and render callouts with the shared settings notice. A body SHALL NOT render a native checkbox, a native select or a bare input that bypasses those components. A body SHALL paint only through theme tokens: no Tailwind palette class, hex or `rgba(` literal, no `var(--accent-<hue>)` as a text colour, no `--text-muted` / `--text-faint` on readable text, and no font size below 11 px (below 12 px inside an interactive element).

This applies to the plugins `apple-tools`, `automation`, `blackhole`, `browser`, `chat-gateway`, `cost-estimator`, `flows-anthropic-bridge`, `grammar`, `quota`, `mcp-client`, `system-one`, `obs-studio`, `goal`, `flows` and `subagents`, in addition to those already on the kit. The MCP server editor modal keeps its schema-driven controls and is out of scope. Third-party JSON-Schema descriptor contributions render through the host form (`UiField` / RJSF, see `dashboard-shell-slots`) and are out of scope.

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

### Requirement: Plugin settings bodies do not repeat the host identity

The host chrome renders the plugin's display name, id, status and Enabled switch. A plugin settings body SHALL NOT render a heading or label whose text equals the plugin's display name or id. A switch inside a body SHALL NOT be labelled "Enabled", "Enable" or "On"; it SHALL name what it controls. Config keys are unchanged by a label change.

#### Scenario: Quota body has no title header
- **WHEN** the user opens `/settings/plugins/quota`
- **THEN** the text "Provider Quota" and the id `quota` SHALL appear only in the host chrome, not in the plugin body

#### Scenario: In-body switches name what they control
- **WHEN** the browser, chat-gateway, grammar and quota settings pages render
- **THEN** their in-body master switches SHALL be labelled "Relay connections", "Answer Discord messages", "Check grammar in the composer" and "Check quotas" respectively
- **AND** each SHALL keep writing the same config key and keep its existing `data-testid`

### Requirement: Configuration values save through the host Save bar

A plugin settings body SHALL buffer every configuration value it writes through `plugin_config_write` or a plugin config-file route into the host Save bar (a settings-draft source) and SHALL NOT write such a value on each keystroke, on blur, or through its own Save button. A secret that is part of the plugin config (for example the chat-gateway bot token) is a configuration value and follows the draft. Two classes SHALL stay immediate: (a) actions with side effects — saving a secret through a plugin's own route (a browser pairing token, a system-one key, an Electron host token), connect/disconnect, start/stop, running an installer, re-arming, and saving the MCP server editor modal; (b) per-item settings owned by a plugin's own REST route that applies them to one item at once — the browser relay switch (`PUT /api/browser/enabled`), a Chrome profile's zero-dialog and allowed-domains values, and an MCP server row's enable switch. An immediate action SHALL show a busy state while running and, on failure, an error notice scoped to the item it acted on, without blanking the rest of the page. A per-browser preference (the goal plugin's auto-restart default) SHALL stay immediate and SHALL be marked as saved in this browser only.

The chat-gateway, flows-anthropic-bridge, cost-estimator and apple-tools settings bodies SHALL register draft sources `plugin:chat-gateway`, `plugin:flows-anthropic-bridge`, `plugin:cost-estimator` and `plugin:apple-tools`. A blank write-only secret (such as the chat-gateway bot token) SHALL NOT be sent on commit. A typed secret SHALL be cleared from the field and from draft state after commit, on discard and on reset, SHALL NOT be echoed back from the server, and SHALL NOT appear in any "Copy details" text, error notice or log line.

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

### Requirement: Field values are validated before save

A plugin settings body SHALL show a field-level error (linked to the control, control marked `aria-invalid`) and block the host Save bar commit while a value is invalid, instead of silently clamping or dropping it. At least: each chat-gateway channel-folder line SHALL match `channelKey=folder`; cost-estimator numbers SHALL respect their ranges (seats ≥ 1, break-after 1–120 minutes, custom price ≥ 0); automation run retention SHALL be ≥ 1.

Empty chat-gateway allowed folders stay a valid config (the gateway refuses spawns at runtime, per `chat-gateway`); the page SHALL show a non-blocking warning notice that no session can start until a folder is added.

#### Scenario: Empty allowed folders warn without blocking
- **WHEN** the chat-gateway allowed-folders field is empty
- **THEN** a warning notice SHALL say no session can start until a folder is added
- **AND** the host Save bar SHALL still allow saving

#### Scenario: Malformed channel-folder line
- **WHEN** the chat-gateway channel folders field contains a line without `=`
- **THEN** the field SHALL show an error naming that line
- **AND** saving SHALL be blocked until the line is fixed or removed

#### Scenario: Empty retention
- **WHEN** the user clears the Runs-to-keep field on the automation page
- **THEN** the field SHALL show an error instead of reverting to 100

### Requirement: Status shows as worded pills and errors as sentences

A plugin settings body SHALL show runtime state as a pill carrying a severity tone, an icon and a human word, never a raw enum or code and never colour alone. A body SHALL show a failure as one sentence that names what to do next, with a "Try again" action where retrying makes sense; raw error codes, HTTP statuses, response bodies and parser messages SHALL be reachable only behind a "Copy details" action. Text that refers to a command or path SHALL render as code, never with literal backticks. Existing i18n keys SHALL be kept; every new or reworded visible string SHALL be added to each locale catalog the plugin already ships (for example `en` + `hu` for grammar), and plugins with no catalog SHALL keep their strings in one place per component so a later catalog can adopt them.

#### Scenario: OBS state word
- **WHEN** an OBS instance reports state `stop-failed`
- **THEN** the OBS settings page SHALL show a pill with a human word for that state, not the string `stop-failed`

#### Scenario: No literal backticks
- **WHEN** the OBS settings page renders the not-provisioned state
- **THEN** `pi-obs provision` SHALL render as a code element with a copy action
- **AND** no backtick character SHALL be visible

#### Scenario: Raw HTTP error stays behind details
- **WHEN** saving subagent settings fails with HTTP 500
- **THEN** the user SHALL see a sentence describing the failure
- **AND** the text `HTTP 500` SHALL appear only in the copied details

### Requirement: Plugin settings sources are lint-guarded

The theme-token guard SHALL scan every plugin client tree. A settings-kit ratchet lint SHALL scan every module referenced by a `settings-section` claim and count native checkboxes, native selects outside the kit, hex colour literals, `rgba(`/`rgb(` literals, Tailwind palette colour classes (such as `text-red-400`, `bg-zinc-800`, `accent-blue-500`), text below 11 px, `--text-muted` / `--text-faint` used as a text colour (`text-[var(…)]` or a `color:` style), and literal headings equal to the plugin's display name or id. The lint SHALL scan every `.tsx` file under the directory holding a claimed settings component, except files on an explicit exempt list kept in the lint (initially only the MCP server editor modal, `mcp-client-plugin/src/client/ServerEditor.tsx`). Identity headers built from i18n keys are not visible to the lint and are covered by per-plugin render tests; a count above the committed baseline, or a new file with a non-zero count, SHALL fail CI. The baseline SHALL only shrink. Every file in a listed plugin's settings render closure (the claimed settings module, or for a claim resolved through the client entry the component's own imports, plus their package-local imports) SHALL have no baseline entry; other files under those directories (boards, chips, panels outside the settings body) MAY carry legacy baseline entries that only shrink.

#### Scenario: Theme-token guard covers plugin trees
- **WHEN** a change adds a hex colour literal to `packages/quota-plugin/src/QuotaSettings.tsx`
- **THEN** the theme-token guard SHALL fail and name the file

#### Scenario: New native checkbox fails the ratchet
- **WHEN** a change adds `<input type="checkbox">` to a plugin settings component
- **THEN** the settings-kit lint SHALL fail and name the file

#### Scenario: Baselines reach zero
- **WHEN** this change is complete
- **THEN** the settings-kit baseline SHALL contain no entry for any file in the settings render closure of the fifteen listed plugins
