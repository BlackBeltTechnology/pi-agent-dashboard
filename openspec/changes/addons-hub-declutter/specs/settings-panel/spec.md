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
the global-scope per-type resource card grids. `packages` SHALL NOT be a page id or a
`SettingsTab` member; it survives only as a legacy URL alias of `add-ons`.

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

### Requirement: Settings panel view
The settings panel SHALL render in a route-backed overlay container in the main content area when the route matches `/settings/:page?/:sub?`: a `Dialog` over a scrim over the pinned background underlay on desktop, and a `MobileShell` depth-1 detail panel on mobile. The route that launched it SHALL remain visible behind it as the pinned underlay, rendered from the frozen background path rather than the current location. It SHALL display a fixed header (back button, title, Restart button), a navigation listing pages grouped by concern, and a content area for the active page. The header SHALL remain visible at all times regardless of scroll position. A single `SettingsPanel` instance SHALL remain mounted across page changes so unsaved edits on any page persist until Save. Persistence SHALL be driven by a dirty-gated **Save Bar** (see "Settings Save Bar"), not by a header Save button.

Dismissing the panel — via the back button, `Esc`, or a backdrop click — SHALL leave the settings surface entirely and return to the route that launched it. Because in-panel navigation pushes history entries, dismissal SHALL NOT be implemented as a single history step.

When the panel holds unsaved edits, a dismissal gesture SHALL prompt before discarding. Confirming the discard SHALL return to the launching route and SHALL NOT navigate to `/`.

The navigation + content layout SHALL be responsive. The wrapper element containing the nav and the content area SHALL stack vertically on narrow (mobile) viewports and arrange side-by-side on wide (desktop, `md` breakpoint and up) viewports. On mobile the navigation SHALL render as a full-width horizontal, horizontally-scrollable tab strip positioned above the content, and the content area SHALL fill the remaining space below it with a non-zero width. On desktop the navigation SHALL render as a fixed-width vertical rail to the left of the content. At no viewport width SHALL the content area collapse to zero width or be positioned outside the visible viewport.

The nav groups SHALL render in this order: Models, Dashboard, Network, Add-ons, Resources, Advanced. The Models group SHALL render FIRST because it holds the settings that decide which model every session, agent and flow runs on (see "Models nav group"). The default page when no `:page` is given SHALL remain General.

The panel SHALL provide these pages (nav groups in brackets):
- **Promoted plugin pages** [Models]: plugin settings pages promoted per "Models nav group", each addressed at `/settings/plugins/<pluginId>`
- **General** [Dashboard]: Interface language, `dashboardName`, display preferences
- **Server** [Dashboard]: `port`, `piPort`, `autoShutdown`, `shutdownIdleSeconds`, `tunnel.enabled`, `tunnel.watchdog.*`, memory limits (`memoryLimits.*`)
- **Sessions** [Dashboard]: `defaultModel`, `spawnStrategy`, reattach/ordering, `askUserPromptTimeoutSeconds`, `spawnRegisterTimeoutMs`, `gitWorktreeEnabled`, retry policy
- **Remote Servers** [Network]: known servers, network discovery
- **Gateway** [Network]: tunnel provider and mode (self-managed save)
- **Security** [Network]: `auth.providers`, `auth.allowedUsers`, `auth.bypassUrls`, `auth.bypassHosts` (Trusted Networks)
- **Providers** [Models]: Providers (one list of everything credentialed, plus an Add-provider dialog), API Proxy
- **Add-ons** [Add-ons]: installed add-ons — extensions, skills and the packages that hold them (page id `add-ons`, formerly `Packages`)
- **Plugins** [Add-ons]: plugin activation index and per-plugin settings pages that are not promoted
- **OpenSpec** [Add-ons]: background polling tuning
- **Developer** [Advanced]: `devBuildOnReload`, `keeperLog.capturePiOutput`, diagnostics, tools, spawn failures, canvas types

Within a page, controls SHALL be grouped into sections by concern, and a control whose effect is gated by another control on the same page SHALL be rendered indented beneath its gating control.

A config key's Save Bar page attribution is resolved from `CONFIG_FIELD_PAGE` by **top-level** key. A field SHALL NOT be rendered on a page other than the one its top-level key maps to, because the dirty-page chip would then name the wrong page.

**Exception — advisory remediation controls.** A page MAY render a control that writes another page's top-level key when ALL of the following hold: the control is part of an advisory whose condition is surfaced to the user on the rendering page (the condition MAY also be reported on non-UI surfaces such as a log or an API field); the advisory names the setting being changed and the page that owns it; and the advisory also offers navigation to the owning page. Such a control is NOT a field: it SHALL NOT render the owning page's editor, SHALL write a single determinate value rather than expose the value space, and SHALL be reachable only while its advisory condition holds. The Save Bar SHALL attribute the resulting dirty state to the **owning** page, unchanged — the exception permits the write, it does not re-attribute it.

#### Scenario: Page layout with nav rail
- **WHEN** the user navigates to `/settings/general`
- **THEN** the panel SHALL display a fixed header (back, "Settings" title, Restart)
- **AND** a left nav rail listing the pages grouped under Models / Dashboard / Network / Add-ons / Resources / Advanced, with Models first
- **AND** the active page's content beside the rail
- **AND** the General page SHALL be selected when no `:page` is given

#### Scenario: Page switching
- **WHEN** the user clicks a different page in the nav rail
- **THEN** the content area SHALL display that page's sections
- **AND** the clicked nav item SHALL show an active indicator
- **AND** the URL SHALL update to `/settings/<page>`

#### Scenario: Fixed header stays visible on scroll
- **WHEN** the active page's content is long enough to scroll
- **THEN** the header and nav rail SHALL remain visible
- **AND** only the page content area SHALL scroll

#### Scenario: Save applies across all pages
- **WHEN** the user modifies fields on multiple pages and clicks Save in the Save Bar
- **THEN** the panel SHALL commit all changed sources (from any page) in a single save operation
- **AND** navigating between pages before Save SHALL NOT discard unsaved edits

#### Scenario: Settings panel back navigation
- **WHEN** the user clicks the back button in the header and the draft is clean
- **THEN** the app SHALL navigate away from settings to the previous view

#### Scenario: Mobile layout keeps content visible
- **WHEN** the user opens `/settings/general` at a viewport width below the `md` breakpoint (e.g. 390 px)
- **THEN** the nav + content wrapper SHALL be laid out vertically (nav above content)
- **AND** the navigation SHALL render as a full-width horizontal, horizontally-scrollable tab strip
- **AND** the content area SHALL have a non-zero width and be fully within the visible viewport (form fields visible without horizontal scrolling)

#### Scenario: Desktop layout unchanged
- **WHEN** the user opens `/settings/general` at a viewport width at or above the `md` breakpoint
- **THEN** the navigation SHALL render as a fixed-width vertical rail to the left of the content
- **AND** the content area SHALL occupy the remaining horizontal space to the right of the rail

#### Scenario: Sessions page sections
- **WHEN** the Sessions page is rendered
- **THEN** its sections SHALL be, in order: new-session defaults, session-list ordering, lifecycle and recovery, worktrees, retry

#### Scenario: PWA display name lives on General
- **WHEN** the General page is rendered
- **THEN** the `dashboardName` field SHALL appear in the Interface section
- **AND** the Sessions page SHALL NOT render a `dashboardName` field

#### Scenario: PWA display name lights the General chip
- **WHEN** the user edits `dashboardName`
- **THEN** the Save Bar SHALL show a dirty chip for **General**
- **AND** SHALL NOT show one for Sessions

#### Scenario: Watchdog stays on Server
- **WHEN** the Server page is rendered
- **THEN** the `tunnel.watchdog.*` fields SHALL appear there, because `tunnel` is a single top-level key attributed to the Server page

#### Scenario: Dependent control is indented
- **WHEN** the Server page renders `shutdownIdleSeconds`
- **THEN** it SHALL be rendered indented beneath the `autoShutdown` toggle that gates it

#### Scenario: Advisory remediation writes the owning page's key
- **GIVEN** the Security page displays the bind reachability advisory
- **WHEN** the user activates its listen-on-all-interfaces control
- **THEN** the working draft SHALL have `bindHost` set to `0.0.0.0`
- **AND** the Save Bar SHALL show a dirty chip for **Server**, the page owning `bindHost`
- **AND** SHALL NOT show one for Security on account of that write

#### Scenario: Advisory remediation does not render the owning editor
- **WHEN** the Security page displays the bind reachability advisory
- **THEN** the listen-interface picker SHALL NOT be rendered on the Security page
- **AND** the advisory SHALL offer navigation to the Server page

#### Scenario: Remediation control disappears with its condition
- **GIVEN** the Security page displays the bind reachability advisory
- **WHEN** the advisory condition no longer holds
- **THEN** the remediation control SHALL no longer be rendered

#### Scenario: Panel renders in an overlay container on desktop
- **WHEN** the route matches `/settings/:page?/:sub?` on a desktop viewport
- **THEN** the settings panel SHALL render in a `Dialog` over a scrim
- **AND** the launching route SHALL be rendered behind it as the pinned underlay, `aria-hidden` and non-interactive

#### Scenario: Panel renders as a depth panel on mobile
- **WHEN** the route matches `/settings/:page?/:sub?` on a mobile viewport
- **THEN** the settings panel SHALL render as a `MobileShell` depth-1 detail panel with swipe-back

#### Scenario: Dismissal after in-panel navigation leaves the surface
- **GIVEN** the user opened `/settings/general` from `/session/abc` and navigated to `/settings/plugins/x`
- **WHEN** the user presses `Esc`
- **THEN** the settings surface SHALL be dismissed entirely
- **AND** the URL SHALL return to `/session/abc`, NOT to `/settings/general`

#### Scenario: Discard confirmation returns to the launching route
- **GIVEN** the user opened the settings surface from `/session/abc` and has unsaved edits
- **WHEN** the user dismisses it and confirms the discard
- **THEN** the URL SHALL return to `/session/abc`
- **AND** SHALL NOT navigate to `/`

### Requirement: Settings SHALL expose global resources as per-type card pages

The settings panel nav SHALL include a `Resources` group listing five pages —
**Skills, Agents, Extensions, Prompts, Themes** — each rendering the
global-scope resources of that type as a card grid using the same
`ResourceCard` component as Directory Settings. Because the settings panel is
global-scope, these pages SHALL NOT render an `All / Local / Global` scope
filter; scope SHALL be indicated by a static `global` affordance. A
name/description search filter SHALL be provided.

#### Scenario: Resources group in the settings nav
- **WHEN** the settings panel nav rail renders
- **THEN** a `Resources` group SHALL list `Skills`, `Agents`, `Extensions`, `Prompts`, `Themes`
- **AND** the `Resources` group SHALL be distinct from the existing `Add-ons` group

#### Scenario: Global-scope type page omits the scope filter
- **WHEN** the user opens the `Skills` page under Settings
- **THEN** global skills SHALL render as cards
- **AND** no `All / Local / Global` scope filter SHALL be shown
