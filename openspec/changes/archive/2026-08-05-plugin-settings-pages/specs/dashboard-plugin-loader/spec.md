## MODIFIED Requirements

### Requirement: Plugin-contributed `settings-section` claims SHALL render ONLY under the owning plugin's row

Every `settings-section` claim SHALL be rendered on the owning plugin's dedicated settings page at `/settings/plugins/<pluginId>`. No other `SettingsPanel` page SHALL render plugin-contributed `settings-section` content.

`SettingsPanel.tsx` SHALL NOT import or render `SettingsSectionSlot` from `dashboard-plugin-runtime`. The legacy `<SettingsSectionSlot tab="..." />` invocations previously fired from every settings page SHALL be removed. `SettingsSectionByPluginSlot` SHALL be the only consumer of `settings-section` claims.

The `claim.tab` field SHALL remain accepted by the manifest validator (preserving backwards-compat for existing manifests) but SHALL be inert at runtime — no consumer SHALL read it, and no value of `tab` SHALL be rejected. The validator SHALL NOT emit any warning when `tab` is present.

`SettingsSectionByPluginSlot` SHALL render BOTH refs-registry claims AND intent broadcasts for `settings-section`, filtered to the owning plugin id, so intent-driven and JSON-Schema-descriptor contributions continue to render after `SettingsSectionSlot` stops consuming the slot.

The plugin's settings page SHALL render host-owned chrome above the plugin's own contribution: display name, plugin id, status pill, enable toggle, declared dependencies (`dependsOn`, `dependents`), claimed slot ids, plus any load error and unsatisfied requirements. Chrome SHALL be limited to fields `GET /api/plugins` returns; it SHALL NOT require `version`, `description`, `source`, or `icon`, which the plugin row does not carry. The plugin's `settings-section` contributions SHALL be rendered beneath that chrome, ordered by the slot registry's existing comparator (ascending `priority`, default 1000, tie-broken by `pluginId` lexicographic order). A plugin SHALL NOT be able to suppress, replace, or opt out of the host chrome.

A plugin's row in the Plugins activation index SHALL display a settings affordance for every plugin. The affordance SHALL be clickable only when at least one `settings-section` claim is registered for that plugin id, and SHALL navigate to `/settings/plugins/<pluginId>`; otherwise the affordance SHALL be rendered disabled (reduced opacity, `cursor-not-allowed`, tooltip indicating no settings are available). The activation index SHALL NOT render plugin settings inline.

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
