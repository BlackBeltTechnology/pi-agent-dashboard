## MODIFIED Requirements

### Requirement: settings-section slot hosts plugin-owned settings UI

The `settings-section` slot SHALL render contributions on the owning plugin's settings page inside `SettingsPanel` (`/settings/plugins/<pluginId>`). Refs-registry claims are ordered by the slot registry's existing comparator: ascending `priority` (default 1000), tie-broken by `pluginId` lexicographic order. The slot accepts both React components (first-party plugins) and JSON-Schema-bearing descriptors (third-party extensions) per the slot's `react-or-descriptor` tier, and the consumer SHALL read BOTH the refs registry and the intent store, filtered to the owning plugin id. Because intent nodes carry no `priority`, the comparator SHALL govern claims only: claims render first in comparator order, then intents in store order. The consumer SHALL additionally apply the enabled set to intents, which the registry's claim-side filter does not cover.

Each `settings-section` contribution SHALL receive `pluginContext` (React variant) or `formValue` + `onChange` (descriptor variant). React contributions persist via `pluginContext.updatePluginConfig({...})`; descriptor contributions persist via the dashboard's standard form-submit handler.

The host SHALL render the plugin's identity, status, enable toggle, and error/requirement state around every contribution. A contribution SHALL NOT be responsible for, and SHALL NOT be able to suppress, that chrome. A contribution SHALL NOT render viewport-fixed elements (such as a `position: fixed` save bar); committing edits is the Save Bar's responsibility.

The host chrome SHALL follow these presentation rules:

- A "← Plugins" back link SHALL render above the chrome card (12 px semibold `--text-secondary`, `ui-contract.md` tap-target: 44 px tall below `sm`, 32 px from `sm`), keeping `data-testid="plugin-page-back-to-index"`; there SHALL be no back link at the bottom of the page.
- The chrome card SHALL show the display name as the page title (`text-lg`), the plugin id at 11 px or larger in `--text-secondary`, and the enable control as a `role="switch"` with the visible label "Enabled" (keeping `data-testid="plugin-page-toggle-<id>"`).
- A status pill SHALL render only when the plugin is not healthy, with the words "Off", "Not loaded", "Needs setup", "Failed to load" or "Status unknown"; a healthy, enabled, loaded plugin with all requirements met SHALL show no status pill.
- Dependency metadata ("Needs …" / "Used by …") SHALL render when the plugin declares any; slot claims SHALL render only when the Developer "Show plugin internals" preference is on, inside a collapsed "Plugin internals" disclosure.
- Error, missing-requirement, restart-required, disabled and not-found banners SHALL use the severity callout recipe (`--severity-*` tokens); no chrome text SHALL be painted with an `--accent-<hue>` fill token, a Tailwind palette class, or `--text-muted`, and no chrome text SHALL be smaller than 11 px.
- The contribution body SHALL be wrapped by the host in a container (`data-testid="plugin-page-body-<id>"`) that spaces its direct children uniformly.
- A plugin load error is diagnostic output: the chrome SHALL show a one-sentence "This plugin failed to load." notice and keep the full error text in the existing copyable error block (an explicit exception to the plugin-body rule that raw errors sit only behind "Copy details").
- The compact chrome variant for promoted plugins (see `dashboard-plugin-loader`) keeps its title, lede and provenance layout and SHALL follow the same switch, pill-word, slot-claim, token, text-size and back-link rules.

#### Scenario: Plugin section appears on its own page under host chrome

- **WHEN** the user opens `/settings/plugins/flows` and the Flows plugin claims `settings-section` with `component: "FlowsSettings"`
- **THEN** the page SHALL render a "← Plugins" back link, then host chrome (display name, id, "Enabled" switch, dependency metadata), followed by `FlowsSettings`
- **AND** no core settings page SHALL render `FlowsSettings`

#### Scenario: Healthy plugin shows no status pill

- **WHEN** `/settings/plugins/flows` renders for an enabled, loaded plugin with no missing requirement
- **THEN** the chrome SHALL show no status pill

#### Scenario: Unhealthy plugin states its problem in words

- **WHEN** the apple-tools plugin is enabled and loaded but a required file is missing
- **THEN** the chrome SHALL show a "Needs setup" pill and a warning callout naming the missing file

#### Scenario: Body children are evenly spaced

- **WHEN** a plugin body renders two top-level blocks
- **THEN** the computed vertical gap between them SHALL equal the host spacing step, without either block setting its own margin

#### Scenario: Slot claims hidden by default

- **WHEN** the Developer "Show plugin internals" preference is off
- **THEN** the chrome SHALL NOT show the plugin's slot claim names

#### Scenario: Third-party extension contributes descriptor settings

- **WHEN** an extension pushes `{ kind: "settings-section", namespace: "judo", schema: {...JSON Schema...} }` via the `extension-ui-system` probe
- **THEN** the owning plugin's settings page SHALL render the schema using the simple `UiField` form (Phase 1 of `extension-ui-system`) or RJSF (Phase 4 once shipped), beneath the host chrome
- **AND** the descriptor SHALL reach the page through the intent store keyed by the contributing plugin id, not through a tab-parameterized consumer

#### Scenario: Reactive update on config change

- **WHEN** a plugin's `updatePluginConfig({...})` succeeds
- **THEN** the server SHALL broadcast `plugin_config_update { id, config }`, and any subscribed `usePluginConfig<T>()` consumers in *any* plugin or section SHALL re-render with the new value within one frame

#### Scenario: Plugin that contributes no settings gets no page

A plugin CONTRIBUTES SETTINGS when it registers a `settings-section` refs claim
OR has a `settings-section` intent in the store. Navigation membership, the
activation-index affordance, and route eligibility SHALL all use that one
predicate — a claims-only test would strand an intent-only contribution.

- **WHEN** a plugin has neither a `settings-section` claim nor a `settings-section` intent
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
