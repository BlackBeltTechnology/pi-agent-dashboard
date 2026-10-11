## MODIFIED Requirements

### Requirement: Canonical and legacy settings URLs
The settings panel SHALL be addressable at the canonical path `/settings/:page?` and SHALL continue to honor the legacy query form `/settings?tab=<id>` indefinitely. Resolution SHALL run inside the single mounted panel in this order: (1) a valid route `:page`; (2) a valid legacy `?tab=<id>`, which SHALL trigger a history-`replace` navigation to `/settings/<id>`; (3) otherwise default to `/settings/general` via history-`replace`. The alias map `advanced → developer`, `servers → remote` and `packages → add-ons` SHALL be applied before validation so old links resolve to the new page homes; an aliased route `:page` SHALL be replace-navigated to its canonical id.

#### Scenario: Canonical page URL
- **WHEN** the user opens `/settings/security`
- **THEN** the Security page SHALL render
- **AND** the URL SHALL remain `/settings/security`

#### Scenario: Legacy query upgrades to canonical
- **WHEN** the user opens `/settings?tab=security`
- **THEN** the panel SHALL `replace`-navigate to `/settings/security`
- **AND** the Security page SHALL render
- **AND** no extra browser-history entry SHALL be added

#### Scenario: Legacy aliased ids resolve to new homes
- **WHEN** the user opens `/settings?tab=advanced` or `/settings?tab=servers`
- **THEN** the panel SHALL resolve to `/settings/developer` and `/settings/remote` respectively

#### Scenario: Old packages URL resolves to Add-ons
- **WHEN** the user opens `/settings/packages` or `/settings?tab=packages`
- **THEN** the panel SHALL `replace`-navigate to `/settings/add-ons`
- **AND** the Add-ons page SHALL render
- **AND** no extra browser-history entry SHALL be added

#### Scenario: Unknown page falls back to general
- **WHEN** the user opens `/settings/bogus`
- **THEN** the panel SHALL `replace`-navigate to `/settings/general`

### Requirement: Settings page-id registry contract

`VALID_SETTINGS_TABS` (and the `SettingsTab` type) SHALL enumerate the full set
of page ids: `general, server, sessions, remote, security, providers, add-ons,
plugins, openspec, skills, agents, extensions, prompts, themes, developer`. The
five resource page ids (`skills, agents, extensions, prompts, themes`) render
the global-scope per-type resource card grids. `packages` SHALL NOT be a page id;
it survives only as a legacy alias of `add-ons`.

`VALID_SETTINGS_TABS` SHALL remain a closed, statically enumerated set. Plugin
settings pages SHALL NOT be added to it; they are addressed by the sub-route
`/settings/plugins/<pluginId>`, parsed into a separate `activePluginId` value
alongside `activeTab = "plugins"`. No settings page SHALL mount
`<SettingsSectionSlot tab={page} />`; the plugin `settings-section` slot no
longer targets a page.

The canonical settings route pattern `/settings/:page?` SHALL accept a second
optional segment, so a three-segment plugin URL matches instead of falling
through to the invalid-page redirect. The second segment SHALL be interpreted
only when the first resolves to `plugins`, and SHALL be ignored for every other
page id. The folder-scoped settings route SHALL NOT host plugin pages: plugin
configuration is global, `plugins` is not a valid folder-settings page id, and
that route renders a different component.

#### Scenario: Plugin sub-route resolves to a plugin page
- **WHEN** the user navigates to `/settings/plugins/roles` and plugin `roles` is installed
- **THEN** the panel SHALL render the `roles` plugin settings page
- **AND** `activeTab` SHALL be `plugins` with `activePluginId` set to `roles`

#### Scenario: Bare plugins route resolves to the activation index
- **WHEN** the user navigates to `/settings/plugins`
- **THEN** the panel SHALL render the plugin activation index

#### Scenario: Unknown plugin id falls back to the index
- **WHEN** the user navigates to `/settings/plugins/not-installed`
- **THEN** the panel SHALL render the activation index with a notice that the requested plugin was not found
- **AND** SHALL NOT render a blank page

#### Scenario: Installed plugin without settings falls back to the index
- **WHEN** the user navigates to `/settings/plugins/demo`, where `demo` is installed and enabled but registers no `settings-section` claim
- **THEN** the panel SHALL render the activation index with a notice, exactly as for an unknown id
- **AND** SHALL NOT render a plugin settings page with an empty body

#### Scenario: Plugin deep link survives a hard reload
- **WHEN** the user hard-reloads the browser on `/settings/plugins/roles`
- **THEN** the panel SHALL render the `roles` plugin settings page
- **AND** SHALL NOT redirect to `/settings/general`

#### Scenario: Folder-scoped settings do not host plugin pages
- **WHEN** the user navigates to `/folder/<encodedCwd>/settings/plugins/flows`
- **THEN** the folder-settings surface SHALL apply its existing invalid-page fallback
- **AND** SHALL NOT render a plugin settings page

#### Scenario: Second segment is ignored for non-plugin pages
- **WHEN** the user navigates to `/settings/server/anything`
- **THEN** the panel SHALL render the Server page and SHALL ignore the trailing segment

#### Scenario: Resource page ids resolve
- **WHEN** the user navigates to `/settings/agents`
- **THEN** the panel SHALL render the global-scope Agents resource card grid

#### Scenario: Add-ons page id resolves
- **WHEN** the user navigates to `/settings/add-ons`
- **THEN** the panel SHALL render the Add-ons page

### Requirement: Plugins nav group lists enabled plugins with settings

The `plugins` entry in the settings navigation rail SHALL be expandable and SHALL sit in the `ADD-ONS` rail group. Its children SHALL be exactly those plugins that are **enabled in config** AND CONTRIBUTE SETTINGS AND are NOT PROMOTED into another nav group (see "Models nav group"), sorted alphabetically by display name. An ENABLED promoted plugin SHALL instead appear in the Plugins subtree, sorted by display name together with the children, as a pointer row naming its destination group (e.g. "Roles ↗ Models"); the pointer SHALL never be marked active, and activating it SHALL navigate to the same `/settings/plugins/<pluginId>` URL. A DISABLED promoted plugin SHALL render no Plugins pointer; it appears only in the Models group. "Contributes settings" SHALL mean the plugin registers at least one `settings-section` refs claim OR has a `settings-section` intent in the intent store — the same predicate that governs route eligibility and the activation-index affordance. `PluginRow.claims` is manifest-derived and does NOT carry intents, so a claims-only test would strand an intent-only contribution: rendered by the slot, but with no nav child and no reachable route. Each child SHALL link to `/settings/plugins/<pluginId>` and SHALL display a status dot reflecting the plugin's health (`loaded`, `not loaded`, `error`).

The subtree SHALL be **collapsed by default**. The `plugins` entry SHALL show the number of children while collapsed and SHALL expose its expanded state to assistive technology. The subtree SHALL expand automatically while a child page (`/settings/plugins/<pluginId>`) is active. A user's explicit expand or collapse SHALL persist across reloads on the same browser; an automatic expansion SHALL NOT overwrite the persisted choice.

Membership SHALL key on the plugin's `enabled` flag, NOT on `loaded`. A plugin that is enabled but failed to load, or has unsatisfied requirements, SHALL remain listed.

A disabled plugin SHALL NOT appear as a nav child. A disabled plugin that is NOT promoted SHALL remain reachable from the plugin activation index, which SHALL indicate that the plugin is absent from the navigation because it is disabled. A disabled PROMOTED plugin is governed by "Models nav group" instead.

#### Scenario: Subtree starts collapsed
- **GIVEN** the user never toggled the Plugins subtree on this browser
- **WHEN** the user opens `/settings/general`
- **THEN** the `Plugins` entry SHALL render collapsed with a child count
- **AND** no plugin child rows SHALL render

#### Scenario: Active child expands the subtree
- **WHEN** the user opens `/settings/plugins/flows` with the subtree collapsed
- **THEN** the subtree SHALL render expanded with the `Flows` child marked active
- **AND** the persisted collapsed choice SHALL remain unchanged

#### Scenario: User choice persists
- **WHEN** the user expands the subtree and reloads `/settings/general`
- **THEN** the subtree SHALL render expanded

#### Scenario: Enabled plugin with settings is listed
- **WHEN** plugin `flows` is enabled, claims `settings-section`, and is not promoted
- **THEN** the expanded `Plugins` nav group SHALL contain a `Flows` child linking to `/settings/plugins/flows`

#### Scenario: Promoted plugin is a pointer, not a child
- **WHEN** plugin `roles` is enabled and its `settings-section` claim is honoured as promoted into `models`
- **THEN** the expanded `Plugins` subtree SHALL render a `Roles ↗ Models` pointer row instead of a regular child
- **AND** the Models group SHALL contain the `Model roles` entry

#### Scenario: Intent-only plugin is listed and routable
- **WHEN** plugin `x` is enabled, registers NO `settings-section` refs claim, and a `settings-section` intent for `x` is present in the intent store
- **THEN** the expanded `Plugins` nav group SHALL contain an `x` child linking to `/settings/plugins/x`
- **AND** `/settings/plugins/x` SHALL render the plugin page rather than falling back to the activation index

#### Scenario: Enabled but failed plugin stays listed
- **WHEN** plugin `automation` is enabled, claims `settings-section`, and its status is `{ loaded: false, error: "..." }`
- **THEN** the expanded `Plugins` nav group SHALL contain an `Automation` child with an error-state status dot

#### Scenario: Disabled plugin is omitted from the rail
- **WHEN** plugin `subagents` claims `settings-section` and is disabled in config
- **THEN** the `Plugins` nav group SHALL NOT contain a `Subagents` child
- **AND** the plugin activation index SHALL mark the `subagents` row as absent from the navigation

#### Scenario: Plugin without settings is omitted from the rail
- **WHEN** plugin `demo` is enabled and registers no `settings-section` claim
- **THEN** the `Plugins` nav group SHALL NOT contain a `Demo` child

#### Scenario: Toggling a plugin updates the rail
- **WHEN** the user disables plugin `flows` from the activation index
- **THEN** the `Flows` nav child SHALL be removed from the rail without a page reload

#### Scenario: The open plugin child is the active nav entry
- **WHEN** the user is on `/settings/plugins/flows`
- **THEN** exactly one nav entry SHALL be marked active: the `Flows` child
- **AND** the parent `Plugins` entry SHALL NOT be marked active

#### Scenario: The parent entry is active only on the index
- **WHEN** the user is on `/settings/plugins`
- **THEN** the parent `Plugins` entry SHALL be marked active
- **AND** no child SHALL be marked active
