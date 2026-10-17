## MODIFIED Requirements

### Requirement: Settings panel view
The settings panel SHALL render in a route-backed overlay container in the main content area when the route matches `/settings/:page?/:sub?`: a `Dialog` over a scrim over the pinned background underlay on desktop, and a `MobileShell` depth-1 detail panel on mobile. The route that launched it SHALL remain visible behind it as the pinned underlay, rendered from the frozen background path rather than the current location. It SHALL display a fixed header (back button, title, Restart button), a navigation listing pages grouped by concern, and a content area for the active page. The header SHALL remain visible at all times regardless of scroll position. A single `SettingsPanel` instance SHALL remain mounted across page changes so unsaved edits on any page persist until Save. Persistence SHALL be driven by a dirty-gated **Save Bar** (see "Settings Save Bar"), not by a header Save button.

Dismissing the panel — via the back button, `Esc`, or a backdrop click — SHALL leave the settings surface entirely and return to the route that launched it. Because in-panel navigation pushes history entries, dismissal SHALL NOT be implemented as a single history step.

When the panel holds unsaved edits, a dismissal gesture SHALL prompt before discarding. Confirming the discard SHALL return to the launching route and SHALL NOT navigate to `/`.

The navigation + content layout SHALL be responsive. The wrapper element containing the nav and the content area SHALL stack vertically on narrow (mobile) viewports and arrange side-by-side on wide (desktop, `md` breakpoint and up) viewports. On mobile the navigation SHALL render as a full-width horizontal, horizontally-scrollable tab strip positioned above the content, and the content area SHALL fill the remaining space below it with a non-zero width. On desktop the navigation SHALL render as a fixed-width vertical rail to the left of the content. At no viewport width SHALL the content area collapse to zero width or be positioned outside the visible viewport.

The nav groups SHALL render in this order: Models, Dashboard, Network, Services, Add-ons, Resources, Advanced. The Models group SHALL render FIRST because it holds the settings that decide which model every session, agent and flow runs on (see "Models nav group"). The default page when no `:page` is given SHALL remain General.

The panel SHALL provide these pages (nav groups in brackets):
- **Promoted plugin pages** [Models]: plugin settings pages promoted per "Models nav group", each addressed at `/settings/plugins/<pluginId>`
- **General** [Dashboard]: Interface language, `dashboardName`, display preferences
- **Server** [Dashboard]: `port`, `piPort`, `autoShutdown`, `shutdownIdleSeconds`, `tunnel.enabled`, `tunnel.watchdog.*`, memory limits (`memoryLimits.*`)
- **Sessions** [Dashboard]: `defaultModel`, `spawnStrategy`, reattach/ordering, `askUserPromptTimeoutSeconds`, `spawnRegisterTimeoutMs`, `gitWorktreeEnabled`, retry policy, pi settings (global `settings.json` editor)
- **Remote Servers** [Network]: known servers, network discovery
- **Gateway** [Network]: tunnel provider and mode (self-managed save)
- **Security** [Network]: `auth.providers`, `auth.allowedUsers`, `auth.bypassUrls`, `auth.bypassHosts` (Trusted Networks)
- **Providers** [Models]: Providers (one list of everything credentialed, plus an Add-provider dialog), API Proxy
- **Add-ons** [Add-ons]: installed add-ons — extensions, skills and the packages that hold them (page id `add-ons`, formerly `Packages`)
- **All services** [Services]: managed-service list, per-service detail at `/settings/services/<id>`, add-service flow, prune (instant-apply, not a Save Bar source)
- **Runtimes** [Services]: container runtime and hypervisor report with capability matrix (read-only)
- **Plugins** [Add-ons]: plugin activation index and per-plugin settings pages that are not promoted
- **OpenSpec** [Add-ons]: background polling tuning
- **Developer** [Advanced]: `devBuildOnReload`, `keeperLog.capturePiOutput`, diagnostics, tools, spawn failures, canvas types

Within a page, controls SHALL be grouped into sections by concern, and a control whose effect is gated by another control on the same page SHALL be rendered indented beneath its gating control.

A config key's Save Bar page attribution is resolved from `CONFIG_FIELD_PAGE` by **top-level** key. A field SHALL NOT be rendered on a page other than the one its top-level key maps to, because the dirty-page chip would then name the wrong page.

**Exception — advisory remediation controls.** A page MAY render a control that writes another page's top-level key when ALL of the following hold: the control is part of an advisory whose condition is surfaced to the user on the rendering page (the condition MAY also be reported on non-UI surfaces such as a log or an API field); the advisory names the setting being changed and the page that owns it; and the advisory also offers navigation to the owning page. Such a control is NOT a field: it SHALL NOT render the owning page's editor, SHALL write a single determinate value rather than expose the value space, and SHALL be reachable only while its advisory condition holds. The Save Bar SHALL attribute the resulting dirty state to the **owning** page, unchanged — the exception permits the write, it does not re-attribute it.

#### Scenario: Page layout with nav rail
- **WHEN** the user navigates to `/settings/general`
- **THEN** the panel SHALL display a fixed header (back, "Settings" title, Restart)
- **AND** a left nav rail listing the pages grouped under Models / Dashboard / Network / Services / Add-ons / Resources / Advanced, with Models first
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
- **THEN** its sections SHALL be, in order: new-session defaults, session-list ordering, lifecycle and recovery, worktrees, retry, pi settings (global)

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

#### Scenario: Services group sits between Network and Add-ons
- **WHEN** the settings panel renders its nav rail
- **THEN** the Services group SHALL appear after Network and before Add-ons
- **AND** it SHALL contain the "All services" and "Runtimes" pages in that order
- **AND** the "All services" page SHALL keep the page id and URL segment `services`

### Requirement: Settings page-id registry contract

`VALID_SETTINGS_TABS` (and the `SettingsTab` type) SHALL enumerate the full set
of page ids: `general, server, sessions, remote, security, providers, add-ons,
plugins, openspec, services, runtimes, skills, agents, extensions, prompts, themes, developer`. The
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
only when the first resolves to `plugins` (a plugin id) or `services` (a
service id, parsed into `activeServiceId`), and SHALL be ignored for every other
page id. The folder-scoped settings route SHALL NOT host plugin or service pages: plugin
configuration and managed services are global, `plugins`, `services` and
`runtimes` are not valid folder-settings page ids, and that route renders a
different component.

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

#### Scenario: Service sub-route resolves to a service detail
- **WHEN** the user navigates to `/settings/services/docling` and service `docling` is defined
- **THEN** the panel SHALL render the `docling` service detail
- **AND** `activeTab` SHALL be `services` with `activeServiceId` set to `docling`

#### Scenario: Unknown service id falls back to the list
- **WHEN** the user navigates to `/settings/services/not-defined`
- **THEN** the panel SHALL render the service list with a notice that the requested service was not found
- **AND** SHALL NOT render a blank page

### Requirement: Settings Save Bar

Provider credentials, custom provider endpoints, and every action on the Services and Runtimes pages are NOT a Save Bar source: they commit on their own action at the point of edit and SHALL NOT contribute a draft, a baseline, or an unsaved-changes count.

The panel SHALL render a Save Bar that is present only when the draft is dirty (any source's draft differs from its baseline) and absent when the draft is clean. The Save Bar SHALL display the count of unsaved changes, a **Discard** action, and a **Save** action. The Save action SHALL always be interactive while the bar is visible (the bar's presence is the dirty signal; the Save control is never shown disabled-because-clean). The Save Bar SHALL reflect four states: **dirty** (idle, awaiting save), **saving** (in flight), **saved** (success — the bar dismisses as the draft re-baselines clean), and **error** (one or more sources failed — Retry offered).

The Save Bar SHALL additionally name every page that holds unsaved edits. Each named page SHALL be an affordance that navigates to that page. Saving remains a single global fan-out across all dirty sources regardless of page; the naming is attribution only and SHALL NOT introduce per-page commit semantics.

#### Scenario: Bar hidden when clean
- **WHEN** the user opens Settings and makes no edits
- **THEN** no Save Bar SHALL be shown
- **AND** no unsaved-changes prompt SHALL fire on navigation

#### Scenario: A provider write does not open the Save Bar
- **WHEN** the user adds, edits, or removes a provider credential or a custom endpoint
- **THEN** the write SHALL commit on its own action
- **AND** the Save Bar SHALL NOT appear on account of that write

#### Scenario: The Providers page keeps its dirty attribution for other sources
- **WHEN** the user edits an API-Proxy control, whose config key is attributed to the Providers page
- **THEN** the Save Bar SHALL appear naming the Providers page
- **AND** the navigation guard SHALL still fire for that edit

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

#### Scenario: Service actions do not dirty the draft
- **WHEN** the user stops a service and saves a secret value on the Services pages
- **THEN** the Save Bar SHALL stay absent and the unsaved-changes count SHALL be unchanged
