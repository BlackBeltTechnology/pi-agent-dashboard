## REMOVED Requirements

### Requirement: settings-section claims target a specific settings tab

**Reason**: Placement by `tab` is retired. A `settings-section` claim now renders on its owning plugin's dedicated page (`/settings/plugins/<pluginId>`), so there is no tab to target, no default to apply, and no unknown value to reject. Keeping tab-routing alive maintained two live render paths for the same claim — the direct cause of plugin settings appearing both on General and under the activation row.

**Migration**: Plugin authors take no action. The `tab` field remains accepted by the manifest validator for backwards compatibility and is ignored at runtime; manifests do not need editing and will not fail validation. A claim that previously rendered on General, Providers, Security, or any other page now renders on its plugin's own page, reachable from the `Plugins` group in the settings navigation rail. Values previously rejected as "unknown tab" are now accepted and ignored.

## MODIFIED Requirements

### Requirement: settings-section slot hosts plugin-owned settings UI

The `settings-section` slot SHALL render contributions on the owning plugin's settings page inside `SettingsPanel` (`/settings/plugins/<pluginId>`). Refs-registry claims are ordered by the slot registry's existing comparator: ascending `priority` (default 1000), tie-broken by `pluginId` lexicographic order. The slot accepts both React components (first-party plugins) and JSON-Schema-bearing descriptors (third-party extensions) per the slot's `react-or-descriptor` tier, and the consumer SHALL read BOTH the refs registry and the intent store, filtered to the owning plugin id. Because intent nodes carry no `priority`, the comparator SHALL govern claims only: claims render first in comparator order, then intents in store order. The consumer SHALL additionally apply the enabled set to intents, which the registry's claim-side filter does not cover.

Each `settings-section` contribution SHALL receive `pluginContext` (React variant) or `formValue` + `onChange` (descriptor variant). React contributions persist via `pluginContext.updatePluginConfig({...})`; descriptor contributions persist via the dashboard's standard form-submit handler.

The host SHALL render the plugin's identity, status, enable toggle, and error/requirement state around every contribution. A contribution SHALL NOT be responsible for, and SHALL NOT be able to suppress, that chrome. A contribution SHALL NOT render viewport-fixed elements (such as a `position: fixed` save bar); committing edits is the Save Bar's responsibility.

#### Scenario: Plugin section appears on its own page under host chrome

- **WHEN** the user opens `/settings/plugins/flows` and the Flows plugin claims `settings-section` with `component: "FlowsSettings"`
- **THEN** the page SHALL render host chrome (display name, id, status pill, enable toggle, dependency and slot metadata) followed by `FlowsSettings`
- **AND** no core settings page SHALL render `FlowsSettings`

#### Scenario: Third-party extension contributes descriptor settings

- **WHEN** an extension pushes `{ kind: "settings-section", namespace: "judo", schema: {...JSON Schema...} }` via the `extension-ui-system` probe
- **THEN** the owning plugin's settings page SHALL render the schema using the simple `UiField` form (Phase 1 of `extension-ui-system`) or RJSF (Phase 4 once shipped), beneath the host chrome
- **AND** the descriptor SHALL reach the page through the intent store keyed by the contributing plugin id, not through a tab-parameterized consumer

#### Scenario: Reactive update on config change

- **WHEN** a plugin's `updatePluginConfig({...})` succeeds
- **THEN** the server SHALL broadcast `plugin_config_update { id, config }`, and any subscribed `usePluginConfig<T>()` consumers in *any* plugin or section SHALL re-render with the new value within one frame

#### Scenario: Plugin without settings claim gets no page

- **WHEN** a plugin has no `settings-section` claim
- **THEN** the settings navigation rail SHALL render no child entry for that plugin and SHALL NOT log a warning
- **AND** the plugin's row in the activation index SHALL render a non-clickable settings affordance that does not navigate
- **AND** a directly typed `/settings/plugins/<id>` URL for that plugin SHALL fall back to the activation index

#### Scenario: Multiple claims from one plugin render in registry order

- **WHEN** plugin `flows` registers two `settings-section` claims with different priorities
- **THEN** its settings page SHALL render both beneath a single host chrome header, ordered by ascending `priority` per the registry comparator

#### Scenario: Claims precede intents when a plugin contributes both

- **WHEN** plugin `flows` registers a `settings-section` claim AND broadcasts a `settings-section` intent
- **THEN** the page SHALL render the claim first and the intent after it
- **AND** the absence of a priority on the intent SHALL NOT be treated as priority 1000 for interleaving

#### Scenario: Disabled plugin's intent does not render

- **WHEN** plugin `flows` is disabled and a `settings-section` intent for `flows` is still present in the intent store
- **THEN** `/settings/plugins/flows` SHALL NOT render that intent
- **AND** the page SHALL show the disabled notice instead
