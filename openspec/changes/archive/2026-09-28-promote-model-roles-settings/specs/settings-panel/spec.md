## ADDED Requirements

### Requirement: Models nav group

The settings navigation SHALL render a **Models** group as its FIRST group. It SHALL contain the built-in **Providers** page followed by every PROMOTED plugin page, ordered by the promotion's `order` (ascending, default 1000), then `nav.label`, then plugin id. The group SHALL render even when no plugin is promoted (Providers alone).

A plugin page is PROMOTED into a group when ALL of the following hold: the plugin declares a `settings-section` claim carrying a `nav` hint whose `group` names that group; the group id is on the host's promotion allowlist, which SHALL contain exactly `models`; the plugin is TRUSTED — its npm package name is in the `@blackbelt-technology/` scope, the host's existing scope-based trust signal (NOT manifest `priority`, which is plugin-authored and doubles as slot render order); and `nav.label` does not collide with any RESERVED label — every built-in settings page label and every nav group label, in the English source AND in every shipped locale (a static set, so the outcome never depends on the active language) — compared after Unicode NFKC normalisation, trimming and case-folding. Among promoted hints, labels SHALL also be unique: when two promoted hints collide, the one that sorts first (by `order`, then plugin id) wins and the other plugin SHALL remain an ordinary Plugins child. First-party status SHALL be computed once by the server and exposed on the `GET /api/plugins` row as a boolean `firstParty`; the client SHALL NOT re-derive it. (`firstParty` is deliberately not named `trusted`: the server's spawn/abort hooks use a different, `priority`-based gate.) A hint failing any condition SHALL be ignored and the plugin SHALL remain an ordinary Plugins child. When a plugin declares more than one `nav`-bearing `settings-section` claim, the first one in manifest order that satisfies every condition SHALL be honoured; the rest SHALL be ignored.

A promoted entry SHALL use `nav.label` as its rail label, the host's generic plugin icon (the hint carries no icon), and the same health dot (`loaded` / `not loaded` / `error`) a Plugins child shows, and SHALL link to `/settings/plugins/<pluginId>` — promotion changes placement, never the URL. On that URL the promoted entry, not the Plugins pointer row, SHALL be the single active nav entry.

A promoted plugin that is installed but DISABLED SHALL remain in the Models group, rendered dimmed with an "off" marker, and its page SHALL render the disabled notice with a re-enable affordance. Its plugin activation index row SHALL state that it is shown in the Models group (not that it is absent from the navigation). A promoted plugin that is not installed SHALL NOT appear.

The Save Bar dirty-page label for a promoted page SHALL read `<Group> › <nav.label>` (e.g. `Models › Model roles`), and its dirty dot SHALL render on the promoted entry.

#### Scenario: Models group is first and holds Providers
- **WHEN** the user opens `/settings`
- **THEN** the first nav group SHALL be `Models`
- **AND** it SHALL contain `Providers`, and the `Extensions` group SHALL NOT contain `Providers`

#### Scenario: Trusted plugin is promoted
- **WHEN** plugin `roles` (package `@blackbelt-technology/pi-dashboard-roles-plugin`) is enabled and claims `{ slot: "settings-section", nav: { group: "models", label: "Model roles" } }`
- **THEN** the Models group SHALL contain a `Model roles` entry linking to `/settings/plugins/roles`

#### Scenario: Untrusted plugin hint is ignored
- **WHEN** plugin `x` from package `acme-dashboard-x` declares `priority: 100` and claims `settings-section` with `nav: { group: "models", label: "Model roles" }`
- **THEN** the Models group SHALL NOT contain an entry for `x`
- **AND** `x` SHALL be listed as an ordinary Plugins child

#### Scenario: Non-allowlisted group is ignored
- **WHEN** a first-party plugin claims `settings-section` with `nav: { group: "dashboard", label: "Foo" }`
- **THEN** no Dashboard entry SHALL be added for it
- **AND** it SHALL be listed as an ordinary Plugins child

#### Scenario: Label colliding with a built-in page is ignored
- **WHEN** a first-party plugin claims `settings-section` with `nav: { group: "models", label: " providers " }` or `label: "Security"`
- **THEN** the Models group SHALL NOT gain an entry with that label
- **AND** the plugin SHALL be listed as an ordinary Plugins child

#### Scenario: Group label and locale label are reserved
- **WHEN** a first-party plugin claims `nav: { group: "models", label: "Dashboard" }` or the Hungarian label of a built-in page
- **THEN** the hint SHALL be ignored regardless of the active locale

#### Scenario: Duplicate promoted labels
- **WHEN** first-party plugins `a` and `b` both claim `nav: { group: "models", label: "Budget" }` with equal `order`
- **THEN** the Models group SHALL contain one `Budget` entry, for plugin `a`
- **AND** `b` SHALL be listed as an ordinary Plugins child

#### Scenario: Failed promoted plugin shows an error dot
- **WHEN** promoted plugin `roles` is enabled and its status is `{ loaded: false, error: "..." }`
- **THEN** its Models entry SHALL show an error-state health dot

#### Scenario: First eligible hint wins
- **WHEN** a first-party plugin declares two `settings-section` claims, the first with `nav.group: "dashboard"` and the second with `nav: { group: "models", label: "Model roles" }`
- **THEN** the plugin SHALL be promoted into Models as `Model roles`

#### Scenario: Promoted entry is the active entry
- **WHEN** the user is on `/settings/plugins/roles` and `roles` is promoted
- **THEN** exactly one nav entry SHALL be marked active: `Models › Model roles`

#### Scenario: Disabled promoted plugin stays reachable
- **WHEN** promoted plugin `roles` is disabled in config
- **THEN** the Models group SHALL still list `Model roles` with an "off" marker
- **AND** `/settings/plugins/roles` SHALL render the disabled notice and a re-enable affordance, without mounting the plugin body
- **AND** the Plugins subtree SHALL render no `Roles` pointer
- **AND** the activation index row for `roles` SHALL state it is shown in the Models group

#### Scenario: Save Bar names the promoted page
- **WHEN** the user edits a role assignment on the promoted page without saving
- **THEN** the Save Bar SHALL list `Models › Model roles` as dirty and the promoted entry SHALL show a dirty dot

## MODIFIED Requirements

### Requirement: Settings panel view
The settings panel SHALL render in a route-backed overlay container in the main content area when the route matches `/settings/:page?/:sub?`: a `Dialog` over a scrim over the pinned background underlay on desktop, and a `MobileShell` depth-1 detail panel on mobile. The route that launched it SHALL remain visible behind it as the pinned underlay, rendered from the frozen background path rather than the current location. It SHALL display a fixed header (back button, title, Restart button), a navigation listing pages grouped by concern, and a content area for the active page. The header SHALL remain visible at all times regardless of scroll position. A single `SettingsPanel` instance SHALL remain mounted across page changes so unsaved edits on any page persist until Save. Persistence SHALL be driven by a dirty-gated **Save Bar** (see "Settings Save Bar"), not by a header Save button.

Dismissing the panel — via the back button, `Esc`, or a backdrop click — SHALL leave the settings surface entirely and return to the route that launched it. Because in-panel navigation pushes history entries, dismissal SHALL NOT be implemented as a single history step.

When the panel holds unsaved edits, a dismissal gesture SHALL prompt before discarding. Confirming the discard SHALL return to the launching route and SHALL NOT navigate to `/`.

The navigation + content layout SHALL be responsive. The wrapper element containing the nav and the content area SHALL stack vertically on narrow (mobile) viewports and arrange side-by-side on wide (desktop, `md` breakpoint and up) viewports. On mobile the navigation SHALL render as a full-width horizontal, horizontally-scrollable tab strip positioned above the content, and the content area SHALL fill the remaining space below it with a non-zero width. On desktop the navigation SHALL render as a fixed-width vertical rail to the left of the content. At no viewport width SHALL the content area collapse to zero width or be positioned outside the visible viewport.

The nav groups SHALL render in this order: Models, Dashboard, Network, Extensions, Resources, Advanced. The Models group SHALL render FIRST because it holds the settings that decide which model every session, agent and flow runs on (see "Models nav group"). The default page when no `:page` is given SHALL remain General.

The panel SHALL provide these pages (nav groups in brackets):
- **Promoted plugin pages** [Models]: plugin settings pages promoted per "Models nav group", each addressed at `/settings/plugins/<pluginId>`
- **General** [Dashboard]: Interface language, `dashboardName`, display preferences
- **Server** [Dashboard]: `port`, `piPort`, `autoShutdown`, `shutdownIdleSeconds`, `tunnel.enabled`, `tunnel.watchdog.*`, memory limits (`memoryLimits.*`)
- **Sessions** [Dashboard]: `defaultModel`, `spawnStrategy`, reattach/ordering, `askUserPromptTimeoutSeconds`, `spawnRegisterTimeoutMs`, `gitWorktreeEnabled`, retry policy
- **Remote Servers** [Network]: known servers, network discovery
- **Gateway** [Network]: tunnel provider and mode (self-managed save)
- **Security** [Network]: `auth.providers`, `auth.allowedUsers`, `auth.bypassUrls`, `auth.bypassHosts` (Trusted Networks)
- **Providers** [Models]: Providers (one list of everything credentialed, plus an Add-provider dialog), API Proxy
- **Packages** [Extensions]: installed pi packages
- **Plugins** [Extensions]: plugin activation index and per-plugin settings pages that are not promoted
- **OpenSpec** [Extensions]: background polling tuning
- **Developer** [Advanced]: `devBuildOnReload`, `keeperLog.capturePiOutput`, diagnostics, tools, spawn failures, canvas types

Within a page, controls SHALL be grouped into sections by concern, and a control whose effect is gated by another control on the same page SHALL be rendered indented beneath its gating control.

A config key's Save Bar page attribution is resolved from `CONFIG_FIELD_PAGE` by **top-level** key. A field SHALL NOT be rendered on a page other than the one its top-level key maps to, because the dirty-page chip would then name the wrong page.

**Exception — advisory remediation controls.** A page MAY render a control that writes another page's top-level key when ALL of the following hold: the control is part of an advisory whose condition is surfaced to the user on the rendering page (the condition MAY also be reported on non-UI surfaces such as a log or an API field); the advisory names the setting being changed and the page that owns it; and the advisory also offers navigation to the owning page. Such a control is NOT a field: it SHALL NOT render the owning page's editor, SHALL write a single determinate value rather than expose the value space, and SHALL be reachable only while its advisory condition holds. The Save Bar SHALL attribute the resulting dirty state to the **owning** page, unchanged — the exception permits the write, it does not re-attribute it.

#### Scenario: Page layout with nav rail
- **WHEN** the user navigates to `/settings/general`
- **THEN** the panel SHALL display a fixed header (back, "Settings" title, Restart)
- **AND** a left nav rail listing the pages grouped under Models / Dashboard / Network / Extensions / Resources / Advanced, with Models first
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

### Requirement: Plugins nav group lists enabled plugins with settings

The `plugins` entry in the settings navigation rail SHALL be expandable. Its children SHALL be exactly those plugins that are **enabled in config** AND CONTRIBUTE SETTINGS AND are NOT PROMOTED into another nav group (see "Models nav group"), sorted alphabetically by display name. An ENABLED promoted plugin SHALL instead appear in the Plugins subtree, sorted by display name together with the children, as a pointer row naming its destination group (e.g. "Roles ↗ Models"); the pointer SHALL never be marked active, and activating it SHALL navigate to the same `/settings/plugins/<pluginId>` URL. A DISABLED promoted plugin SHALL render no Plugins pointer; it appears only in the Models group. "Contributes settings" SHALL mean the plugin registers at least one `settings-section` refs claim OR has a `settings-section` intent in the intent store — the same predicate that governs route eligibility and the activation-index affordance. `PluginRow.claims` is manifest-derived and does NOT carry intents, so a claims-only test would strand an intent-only contribution: rendered by the slot, but with no nav child and no reachable route. Each child SHALL link to `/settings/plugins/<pluginId>` and SHALL display a status dot reflecting the plugin's health (`loaded`, `not loaded`, `error`).

Membership SHALL key on the plugin's `enabled` flag, NOT on `loaded`. A plugin that is enabled but failed to load, or has unsatisfied requirements, SHALL remain listed.

A disabled plugin SHALL NOT appear as a nav child. A disabled plugin that is NOT promoted SHALL remain reachable from the plugin activation index, which SHALL indicate that the plugin is absent from the navigation because it is disabled. A disabled PROMOTED plugin is governed by "Models nav group" instead.

#### Scenario: Enabled plugin with settings is listed
- **WHEN** plugin `flows` is enabled, claims `settings-section`, and is not promoted
- **THEN** the `Plugins` nav group SHALL contain a `Flows` child linking to `/settings/plugins/flows`

#### Scenario: Promoted plugin is a pointer, not a child
- **WHEN** plugin `roles` is enabled and its `settings-section` claim is honoured as promoted into `models`
- **THEN** the `Plugins` subtree SHALL render a `Roles ↗ Models` pointer row instead of a regular child
- **AND** the Models group SHALL contain the `Model roles` entry

#### Scenario: Intent-only plugin is listed and routable
- **WHEN** plugin `x` is enabled, registers NO `settings-section` refs claim, and a `settings-section` intent for `x` is present in the intent store
- **THEN** the `Plugins` nav group SHALL contain an `x` child linking to `/settings/plugins/x`
- **AND** `/settings/plugins/x` SHALL render the plugin page rather than falling back to the activation index

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
- **WHEN** the user is on `/settings/plugins/flows`
- **THEN** exactly one nav entry SHALL be marked active: the `Flows` child
- **AND** the parent `Plugins` entry SHALL NOT be marked active

#### Scenario: The parent entry is active only on the index
- **WHEN** the user is on `/settings/plugins`
- **THEN** the parent `Plugins` entry SHALL be marked active
- **AND** no child SHALL be marked active
