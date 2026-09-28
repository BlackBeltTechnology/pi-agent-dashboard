## MODIFIED Requirements

### Requirement: Plugin-contributed `settings-section` claims SHALL render ONLY under the owning plugin's row

Every `settings-section` claim SHALL be rendered on the owning plugin's dedicated settings page at `/settings/plugins/<pluginId>`. No other `SettingsPanel` page SHALL render plugin-contributed `settings-section` content.

`SettingsPanel.tsx` SHALL NOT import or render `SettingsSectionSlot` from `dashboard-plugin-runtime`. The legacy `<SettingsSectionSlot tab="..." />` invocations previously fired from every settings page SHALL be removed. `SettingsSectionByPluginSlot` SHALL be the only consumer of `settings-section` claims.

A `settings-section` claim MAY carry an optional `nav` hint `{ group: string, label: string, description?: string, order?: number }` asking the host to PROMOTE the owning plugin's page into a settings nav group. The hint SHALL change only where the page's nav entry appears and which chrome variant it gets; the page SHALL still render at `/settings/plugins/<pluginId>` and nowhere else. An invalid `nav` SHALL NOT fail manifest validation (a placement hint must never unload a plugin): the validator SHALL DROP the hint from the normalised claim, emit a warning on the server log naming the plugin id, claim index and offending field, and load the plugin normally. A hint is invalid when it is not a plain object (including `null` and arrays); `label` or `group` is missing, non-string, or empty after trimming; `description` is present and non-string; `label` exceeds 40 or `description` exceeds 200 characters after normalisation; `label` or `description` contains any Unicode control (Cc) or format (Cf) character — covering bidi overrides, zero-width and directional marks, and BOM; or `order` is present and not a finite number. Valid `group`/`label`/`description` SHALL be stored NFKC-normalised and trimmed; a `description` that is empty after trimming SHALL be dropped on its own, keeping the rest of the hint. `nav` on a claim whose slot is not `settings-section` SHALL be dropped without a warning. An unknown `group` value SHALL be accepted (forward-compat) and left to the host to ignore. Whether a hint is honoured (group allowlist, plugin trust) is decided by the host (see settings-panel "Models nav group"), not the validator. `GET /api/plugins` SHALL include the validated `nav` on each projected claim, and a boolean `firstParty` on each row (true iff the plugin's npm package name is in the `@blackbelt-technology/` scope). `nav.label` and `nav.description` SHALL render as plain text, never as markup.

The `claim.tab` field SHALL remain accepted by the manifest validator (preserving backwards-compat for existing manifests) but SHALL be inert at runtime — no consumer SHALL read it, and no value of `tab` SHALL be rejected. The validator SHALL NOT emit any warning when `tab` is present.

`SettingsSectionByPluginSlot` SHALL render BOTH refs-registry claims AND intent broadcasts for `settings-section`, filtered to the owning plugin id, so intent-driven and JSON-Schema-descriptor contributions continue to render after `SettingsSectionSlot` stops consuming the slot.

The plugin's settings page SHALL render host-owned chrome above the plugin's own contribution: display name, plugin id, status pill, enable toggle, declared dependencies (`dependsOn`, `dependents`), claimed slot ids, plus any load error and unsatisfied requirements. Chrome SHALL be limited to fields `GET /api/plugins` returns; it SHALL NOT require `version`, `description`, `source`, or `icon`, which the plugin row does not carry. The plugin's `settings-section` contributions SHALL be rendered beneath that chrome, ordered by the slot registry's existing comparator (ascending `priority`, default 1000, tie-broken by `pluginId` lexicographic order). A plugin SHALL NOT be able to suppress, replace, or opt out of the host chrome.

For a PROMOTED plugin page the host SHALL render a COMPACT chrome variant instead: `nav.label` as the page title, `nav.description` (when present) as a lede, and a provenance line "Provided by the <displayName> plugin" (with Unicode Cc/Cf characters removed from `displayName` at render) carrying the enable toggle and a disclosure that reveals the plugin id, declared dependencies (`dependsOn`), dependents, and claimed slot ids. The status pill SHALL render in the header (never inside the disclosure) only when the plugin is not healthy — `disabled`, `error`, `not loaded`, unknown status (none reported), or unsatisfied requirements — and SHALL be absent when the plugin is enabled, loaded and has every requirement met; load errors and missing-requirement banners SHALL render exactly as in the full chrome. The compact variant is selected by the host from the honoured promotion; the plugin still cannot suppress or replace it.

A plugin's row in the Plugins activation index SHALL display a settings affordance for every plugin. The affordance SHALL be clickable only when that plugin CONTRIBUTES SETTINGS — i.e. at least one `settings-section` refs claim is registered for its id OR a `settings-section` intent is present for it — and SHALL navigate to `/settings/plugins/<pluginId>`; otherwise the affordance SHALL be rendered disabled (reduced opacity, `cursor-not-allowed`, tooltip indicating no settings are available). The activation index SHALL NOT render plugin settings inline.

The settings page of a plugin that is installed but disabled SHALL still resolve. Because the slot-registry enabled-set filter removes a disabled plugin's claims from every consumer, that page SHALL render the host chrome, a notice that the plugin is disabled, and a re-enable affordance, and SHALL NOT render the plugin's settings body. A disabled plugin's settings component SHALL NOT be mounted.

#### Scenario: Plugin settings render on their plugin page only

- **WHEN** plugin `roles` declares a `settings-section` claim and is enabled
- **THEN** navigating to `/settings/plugins/roles` SHALL render the plugin's settings section component beneath the host chrome, and no other settings page SHALL render it

#### Scenario: `tab` field is inert

- **WHEN** plugin `roles` declares `{ slot: "settings-section", tab: "general", component: "RolesSettings" }` and is enabled
- **THEN** the validator SHALL accept the manifest without warning, the `RolesSettings` component SHALL render only on `/settings/plugins/roles`, and the General page SHALL NOT contain any plugin-contributed `settings-section` content

#### Scenario: Unknown `tab` value is accepted and ignored

- **WHEN** plugin `x` declares `{ slot: "settings-section", tab: "nonexistent" }`
- **THEN** manifest validation SHALL succeed, the plugin SHALL load normally, and its section SHALL render on `/settings/plugins/x`

#### Scenario: Disabled plugin page renders chrome without a body

- **WHEN** plugin `demo` declares `{ slot: "settings-section" }` but is disabled in config
- **THEN** `/settings/plugins/demo` SHALL render the host chrome with a `disabled` status pill, a notice that the plugin is disabled, and a re-enable affordance
- **AND** the plugin's settings component SHALL NOT be mounted

#### Scenario: Disabling a plugin while its page is open collapses the body

- **WHEN** the user is on `/settings/plugins/flows` and disables the plugin
- **THEN** the enabled-set update SHALL remove the plugin's claims and the page SHALL replace the settings body with the disabled notice without a reload
- **AND** the host chrome SHALL remain rendered

#### Scenario: Intent-driven contribution renders on the plugin page

- **WHEN** a plugin broadcasts a `settings-section` intent rather than registering a refs-registry claim
- **THEN** `/settings/plugins/<pluginId>` SHALL render that contribution beneath the host chrome
- **AND** no other settings page SHALL render it

#### Scenario: Enabled-but-failed plugin page is reachable

- **WHEN** plugin `automation` is enabled and its status is `{ loaded: false, error: "Bridge path conflict: ..." }`
- **THEN** `/settings/plugins/automation` SHALL render the host chrome with an `error` status pill and the full error text in a copy-on-click block

#### Scenario: SettingsPanel does not import SettingsSectionSlot

- **WHEN** the repo-lint test reads `packages/client/src/components/settings/SettingsPanel.tsx`
- **THEN** the file SHALL NOT contain the string `SettingsSectionSlot`

#### Scenario: Activation index does not render settings inline

- **WHEN** the user opens `/settings/plugins` and clicks the settings affordance on the `roles` row
- **THEN** the client SHALL navigate to `/settings/plugins/roles`
- **AND** no `settings-section` content SHALL be rendered inside the activation list itself

#### Scenario: Valid nav hint is accepted and projected
- **WHEN** plugin `roles` declares `{ slot: "settings-section", component: "BuiltInRolesSettings", nav: { group: "models", label: "Model roles", description: "Pick which model answers each @role." } }`
- **THEN** manifest validation SHALL succeed
- **AND** the plugin's row from `GET /api/plugins` SHALL carry that `nav` on its `settings-section` claim

#### Scenario: Malformed nav hint is dropped, plugin still loads
- **WHEN** a plugin declares `nav: { group: "models", label: "   " }`, `nav: "models"`, `nav: null`, `nav: []`, or a 41-character label
- **THEN** manifest validation SHALL succeed and the plugin SHALL load with all its other claims
- **AND** the normalised claim SHALL carry no `nav`, and one warning SHALL name the plugin id, claim index and field

#### Scenario: Control characters invalidate the hint
- **WHEN** a plugin declares `nav.label` containing U+202E, U+200E, U+200B or a newline
- **THEN** the hint SHALL be dropped with a warning and the plugin SHALL load normally

#### Scenario: Blank description is dropped alone
- **WHEN** a plugin declares `nav: { group: "models", label: "Model roles", description: "  " }`
- **THEN** the normalised claim SHALL carry `nav: { group: "models", label: "Model roles" }` and the plugin SHALL still be promoted

#### Scenario: Unknown nav group is accepted
- **WHEN** a plugin declares `nav: { group: "future-group", label: "X" }`
- **THEN** manifest validation SHALL succeed and the plugin SHALL load normally

#### Scenario: Promoted page renders compact chrome
- **WHEN** `roles` is promoted and healthy and the user opens `/settings/plugins/roles`
- **THEN** the page title SHALL be `Model roles` with the `nav.description` lede
- **AND** a "Provided by the Roles plugin" line SHALL carry the enable toggle
- **AND** no status pill SHALL render, and the plugin id, dependencies, dependents and claimed-slot list SHALL be visible only after the details disclosure is opened

#### Scenario: Disabled promoted page shows the disabled pill
- **WHEN** `roles` is promoted and disabled and the user opens `/settings/plugins/roles`
- **THEN** the compact chrome SHALL show a `disabled` status pill, the disabled notice and a re-enable affordance
- **AND** the plugin's settings component SHALL NOT be mounted

#### Scenario: Promoted page surfaces a load error
- **WHEN** `roles` is promoted, enabled, and its status is `{ loaded: false, error: "..." }`
- **THEN** the compact chrome SHALL show an `error` status pill and the full error text in a copy-on-click block

#### Scenario: Nav label is rendered as text
- **WHEN** a first-party plugin declares `nav.label` containing `<b>x</b>`
- **THEN** the rail and page title SHALL display the literal characters, not bold markup
