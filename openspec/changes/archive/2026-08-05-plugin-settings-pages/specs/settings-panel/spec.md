## MODIFIED Requirements

### Requirement: Settings page-id registry contract

`VALID_SETTINGS_TABS` (and the `SettingsTab` type) SHALL enumerate the full set
of page ids: `general, server, sessions, remote, security, providers, packages,
plugins, openspec, skills, agents, extensions, prompts, themes, developer`. The
five resource page ids (`skills, agents, extensions, prompts, themes`) render
the global-scope per-type resource card grids.

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

### Requirement: Per-page dirty indicators

Each page in the left navigation rail SHALL display a dirty indicator when any settings source belonging to that page has unsaved edits, and SHALL clear it when those sources are clean (saved or discarded).

Plugin settings pages SHALL participate in this mechanism under the page id `plugins/<pluginId>`, so a dirty plugin page marks its own nav entry, not the parent `plugins` entry.

The **host** SHALL assign that page id. Any settings draft source registered from within a plugin settings page SHALL be filed under `plugins/<pluginId>` regardless of any `page` value the plugin supplies, so a plugin cannot direct its dirty indicator at an unrelated page. Plugin-supplied `page` values SHALL be ignored for sources registered inside a plugin settings page.

#### Scenario: Dirty page shows an indicator
- **WHEN** the user edits a field on the Server page and switches to another page without saving
- **THEN** the Server page's nav entry SHALL show a dirty indicator

#### Scenario: Indicator clears after save
- **WHEN** the user saves and the Server page's sources commit successfully
- **THEN** the Server page's dirty indicator SHALL clear

#### Scenario: Dirty plugin page marks its own nav child
- **WHEN** the user edits a control on `/settings/plugins/hermes-memory` and navigates away without saving
- **THEN** the `Hermes Memory` nav child SHALL show a dirty indicator
- **AND** the parent `Plugins` nav entry SHALL NOT show one on its own behalf

#### Scenario: Plugin-supplied page value is overridden
- **WHEN** a plugin registers a draft source declaring `page: "general"` from inside `/settings/plugins/roles`
- **THEN** the source SHALL be filed under `plugins/roles`
- **AND** the General page SHALL NOT show a dirty indicator on that source's behalf

### Requirement: Settings Save Bar

The panel SHALL render a Save Bar that is present only when the draft is dirty (any source's draft differs from its baseline) and absent when the draft is clean. The Save Bar SHALL display the count of unsaved changes, a **Discard** action, and a **Save** action. The Save action SHALL always be interactive while the bar is visible (the bar's presence is the dirty signal; the Save control is never shown disabled-because-clean). The Save Bar SHALL reflect four states: **dirty** (idle, awaiting save), **saving** (in flight), **saved** (success — the bar dismisses as the draft re-baselines clean), and **error** (one or more sources failed — Retry offered).

The Save Bar SHALL additionally name every page that holds unsaved edits. Each named page SHALL be an affordance that navigates to that page. Saving remains a single global fan-out across all dirty sources regardless of page; the naming is attribution only and SHALL NOT introduce per-page commit semantics.

#### Scenario: Bar hidden when clean
- **WHEN** the user opens Settings and makes no edits
- **THEN** no Save Bar SHALL be shown
- **AND** no unsaved-changes prompt SHALL fire on navigation

#### Scenario: Bar appears on first edit
- **WHEN** the user changes any setting from its loaded value
- **THEN** the Save Bar SHALL appear showing the unsaved-changes count, Discard, and Save

#### Scenario: Discard reverts to baseline
- **WHEN** the user clicks Discard in the Save Bar
- **THEN** every source's draft SHALL reset to its baseline
- **AND** the Save Bar SHALL disappear

#### Scenario: Saving and saved states
- **WHEN** the user clicks Save with dirty sources
- **THEN** the Save Bar SHALL show a saving state while requests are in flight
- **AND** on full success SHALL re-baseline all committed sources and dismiss

#### Scenario: Error state offers retry
- **WHEN** Save completes with at least one failed source
- **THEN** the Save Bar SHALL remain visible in an error state with a Retry action
- **AND** the unsaved-changes count SHALL reflect only the still-dirty sources

#### Scenario: Bar names every dirty page
- **WHEN** the user has unsaved edits on the Server page and then, without saving, opens `/settings/plugins/goal` and edits a control there
- **THEN** the Save Bar SHALL name both pages
- **AND** clicking the `Plugins › Goal` name SHALL navigate to `/settings/plugins/goal`

#### Scenario: One Save commits every page
- **WHEN** the Save Bar names two pages and the user clicks Save
- **THEN** a single fan-out SHALL commit the dirty sources of both pages
- **AND** both pages' dirty indicators SHALL clear

### Requirement: Unsaved-changes navigation guards

When the draft is dirty, the panel SHALL guard against losing edits on exit. In-app navigation away from the Settings panel (the header Back button, route change, browser back/forward) SHALL be intercepted with a confirm dialog offering **Save changes**, **Discard**, and **Cancel (keep editing)**. Hard exits that JavaScript cannot intercept with a custom dialog (tab close, reload, Electron window close) SHALL be guarded with a `beforeunload` handler that is registered only while the draft is dirty. When the draft is clean, no guard SHALL fire.

Navigation **between settings pages via the left rail** SHALL be guarded when, and only when, the page being left is a plugin settings page holding dirty sources. A plugin's draft state lives in the plugin's own component and is destroyed when that component unmounts on a page switch, so an unguarded rail navigation silently discards it. Built-in pages SHALL NOT be guarded on rail navigation, because their draft state survives the switch; guarding them on aggregate panel dirtiness would prevent a user from ever making edits on two pages before one Save.

#### Scenario: In-app back with unsaved changes prompts
- **WHEN** the draft is dirty and the user clicks the header Back button
- **THEN** a confirm dialog SHALL appear offering Save changes, Discard, and Cancel
- **AND** choosing Cancel SHALL keep the user in the Settings panel with edits intact

#### Scenario: Discard from the dialog leaves without saving
- **WHEN** the unsaved-changes confirm dialog is shown and the user chooses Discard
- **THEN** the draft SHALL reset to baseline and the app SHALL navigate away

#### Scenario: Save from the dialog persists then leaves
- **WHEN** the unsaved-changes confirm dialog is shown and the user chooses Save changes
- **THEN** the panel SHALL run the Save fan-out and, on full success, navigate away

#### Scenario: beforeunload registered only while dirty
- **WHEN** the draft is dirty
- **THEN** a `beforeunload` handler SHALL be active so tab close / reload / window close triggers the browser's leave prompt
- **AND** when the draft is clean the handler SHALL NOT be registered

#### Scenario: Rail navigation away from a dirty plugin page prompts
- **WHEN** the user has unsaved edits on `/settings/plugins/flows` and clicks another entry in the settings rail
- **THEN** the confirm dialog SHALL appear before the plugin page unmounts
- **AND** choosing Cancel SHALL keep the user on the plugin page with edits intact

#### Scenario: Rail navigation from a dirty built-in page does not prompt
- **WHEN** the user has unsaved edits on the Server page and clicks another entry in the settings rail
- **THEN** no confirm dialog SHALL appear
- **AND** the Server page's edits SHALL remain in the draft and its dirty indicator SHALL persist

## ADDED Requirements

### Requirement: Plugins nav group lists enabled plugins with settings

The `plugins` entry in the settings navigation rail SHALL be expandable. Its children SHALL be exactly those plugins that are **enabled in config** AND register at least one `settings-section` claim, sorted alphabetically by display name. Each child SHALL link to `/settings/plugins/<pluginId>` and SHALL display a status dot reflecting the plugin's health (`loaded`, `not loaded`, `error`).

Membership SHALL key on the plugin's `enabled` flag, NOT on `loaded`. A plugin that is enabled but failed to load, or has unsatisfied requirements, SHALL remain listed.

A disabled plugin SHALL NOT appear as a nav child. It SHALL remain reachable from the plugin activation index, which SHALL indicate that the plugin is absent from the navigation because it is disabled.

#### Scenario: Enabled plugin with settings is listed
- **WHEN** plugin `roles` is enabled and claims `settings-section`
- **THEN** the `Plugins` nav group SHALL contain a `Roles` child linking to `/settings/plugins/roles`

#### Scenario: Enabled but failed plugin stays listed
- **WHEN** plugin `automation` is enabled, claims `settings-section`, and its status is `{ loaded: false, error: "..." }`
- **THEN** the `Plugins` nav group SHALL contain an `Automation` child with an error-state status dot

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
- **WHEN** the user is on `/settings/plugins/roles`
- **THEN** exactly one nav entry SHALL be marked active: the `Roles` child
- **AND** the parent `Plugins` entry SHALL NOT be marked active

#### Scenario: The parent entry is active only on the index
- **WHEN** the user is on `/settings/plugins`
- **THEN** the parent `Plugins` entry SHALL be marked active
- **AND** no child SHALL be marked active
