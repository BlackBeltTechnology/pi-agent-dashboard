## MODIFIED Requirements

### Requirement: Settings panel view
The settings panel SHALL render in a route-backed overlay container in the main content area when the route matches `/settings/:page?/:sub?`: a `Dialog` over a scrim over the pinned background underlay on desktop, and a `MobileShell` depth-1 detail panel on mobile. The route that launched it SHALL remain visible behind it as the pinned underlay, rendered from the frozen background path rather than the current location. It SHALL display a fixed header (back button, title, Restart button), a navigation listing pages grouped by concern, and a content area for the active page. The header SHALL remain visible at all times regardless of scroll position. A single `SettingsPanel` instance SHALL remain mounted across page changes so unsaved edits on any page persist until Save. Persistence SHALL be driven by a dirty-gated **Save Bar** (see "Settings Save Bar"), not by a header Save button.

Dismissing the panel — via the back button, `Esc`, or a backdrop click — SHALL leave the settings surface entirely and return to the route that launched it. Because in-panel navigation pushes history entries, dismissal SHALL NOT be implemented as a single history step.

When the panel holds unsaved edits, a dismissal gesture SHALL prompt before discarding. Confirming the discard SHALL return to the launching route and SHALL NOT navigate to `/`.

The navigation + content layout SHALL be responsive. The wrapper element containing the nav and the content area SHALL stack vertically on narrow (mobile) viewports and arrange side-by-side on wide (desktop, `md` breakpoint and up) viewports. On mobile the navigation SHALL render as a full-width horizontal, horizontally-scrollable tab strip positioned above the content, and the content area SHALL fill the remaining space below it with a non-zero width. On desktop the navigation SHALL render as a fixed-width vertical rail to the left of the content. At no viewport width SHALL the content area collapse to zero width or be positioned outside the visible viewport.

The panel SHALL provide these pages (nav groups in brackets):
- **General** [Dashboard]: Interface language, `dashboardName`, display preferences
- **Server** [Dashboard]: `port`, `piPort`, `autoShutdown`, `shutdownIdleSeconds`, `tunnel.enabled`, `tunnel.watchdog.*`, memory limits (`memoryLimits.*`)
- **Sessions** [Dashboard]: `defaultModel`, `spawnStrategy`, reattach/ordering, `askUserPromptTimeoutSeconds`, `spawnRegisterTimeoutMs`, `gitWorktreeEnabled`, retry policy
- **Remote Servers** [Network]: known servers, network discovery
- **Gateway** [Network]: tunnel provider and mode (self-managed save)
- **Security** [Network]: `auth.providers`, `auth.allowedUsers`, `auth.bypassUrls`, `auth.bypassHosts` (Trusted Networks)
- **Providers** [Extensions]: Providers (one list of everything credentialed, plus an Add-provider dialog), API Proxy
- **Packages** [Extensions]: installed pi packages
- **Plugins** [Extensions]: plugin activation index and per-plugin settings pages
- **OpenSpec** [Extensions]: background polling tuning
- **Developer** [Advanced]: `devBuildOnReload`, `keeperLog.capturePiOutput`, diagnostics, tools, spawn failures, canvas types

Within a page, controls SHALL be grouped into sections by concern, and a control whose effect is gated by another control on the same page SHALL be rendered indented beneath its gating control.

A config key's Save Bar page attribution is resolved from `CONFIG_FIELD_PAGE` by **top-level** key. A field SHALL NOT be rendered on a page other than the one its top-level key maps to, because the dirty-page chip would then name the wrong page.

**Exception — advisory remediation controls.** A page MAY render a control that writes another page's top-level key when ALL of the following hold: the control is part of an advisory whose condition is surfaced to the user on the rendering page (the condition MAY also be reported on non-UI surfaces such as a log or an API field); the advisory names the setting being changed and the page that owns it; and the advisory also offers navigation to the owning page. Such a control is NOT a field: it SHALL NOT render the owning page's editor, SHALL write a single determinate value rather than expose the value space, and SHALL be reachable only while its advisory condition holds. The Save Bar SHALL attribute the resulting dirty state to the **owning** page, unchanged — the exception permits the write, it does not re-attribute it.

#### Scenario: Page layout with nav rail
- **WHEN** the user navigates to `/settings/general`
- **THEN** the panel SHALL display a fixed header (back, "Settings" title, Restart)
- **AND** a left nav rail listing the pages grouped under Dashboard / Network / Extensions / Advanced
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

### Requirement: Settings Save Bar

Provider credentials and custom provider endpoints are NOT a Save Bar source: they commit on their own action at the point of edit and SHALL NOT contribute a draft, a baseline, or an unsaved-changes count.

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

### Requirement: Save button applies changes

The panel SHALL persist changes via a single Save action that fans out to every dirty backing store. Each settings source (`config.json` via `PUT /api/config`, display preferences via `PATCH /api/preferences/display`, worktree auto-init pref, OpenSpec profile via `POST /api/openspec/config`, and each plugin settings section) SHALL contribute a draft and a baseline. Provider credentials and custom provider endpoints SHALL NOT be a source: they are written at the point of edit, not fanned out from Save. On Save the panel SHALL commit only sources whose draft differs from their baseline. For the `config.json` source the panel SHALL compute a field-level diff and send only changed fields. Save SHALL NOT claim cross-store atomicity: it SHALL commit each dirty source independently, re-baseline sources that succeed, and keep sources that fail in the dirty state with a Retry affordance.

#### Scenario: Save sends only changed fields
- **WHEN** the user edits one or more `config.json` settings fields and saves
- **THEN** the panel SHALL compute a diff against the loaded config
- **AND** SHALL send only the changed fields in the `PUT /api/config` request body

#### Scenario: Save commits only dirty sources
- **WHEN** the user changes a display-preference toggle and an `auth` field, then saves
- **THEN** the panel SHALL commit the display-preferences source and the config source
- **AND** SHALL NOT call endpoints for sources that are unchanged

#### Scenario: Partial save failure keeps failed source dirty
- **WHEN** Save commits multiple dirty sources and one source's request fails
- **THEN** the panel SHALL re-baseline the sources that succeeded (clearing their dirty state)
- **AND** SHALL keep the failed source dirty
- **AND** SHALL surface a per-source error with a Retry affordance and NOT discard the failed source's edits

#### Scenario: Provider writes are not part of the fan-out
- **WHEN** the user has written a provider credential or a custom endpoint and then clicks Save for other dirty sources
- **THEN** the fan-out SHALL NOT include any provider write
- **AND** the already-written provider state SHALL be unaffected by Save or Discard

### Requirement: Provider save refreshes available models
When a custom provider is written from the Settings panel — through a single-provider create, update, or delete, or the retained whole-map write — the server SHALL broadcast a `credentials_updated` message to all connected pi sessions. This MUST cause the model registry to refresh and push updated `models_list` messages back to the dashboard client, keeping every session-scoped model selector current.

The Settings panel's **Default Model** selector SHALL NOT depend on that broadcast for its own correctness. It is sourced from the union of the session-independent `GET /api/models` catalogue and the per-session model lists, and the catalogue half is refreshed by the panel's own refetch, so the selector SHALL display the updated model list without requiring a server restart **and without requiring any connected pi session**.

#### Scenario: Saving new provider populates model selector
- **WHEN** the user adds a new custom provider from the Add-provider dialog
- **THEN** the server broadcasts `credentials_updated` to all sessions
- **AND** each session's bridge refreshes its model registry
- **AND** each session-scoped model selector shows models from the new provider

#### Scenario: Saving new provider populates the Default Model selector
- **WHEN** the user adds a new custom provider from the Add-provider dialog
- **THEN** the Settings panel refetches `GET /api/models`
- **AND** the Default Model selector shows models from the new provider
- **AND** this holds whether or not any pi session is connected

#### Scenario: Removing a provider updates model selector
- **WHEN** the user removes a custom provider from its row
- **THEN** models from the removed provider no longer appear in the Default Model selector, unless a live session still reports them
- **AND** they no longer appear in session-scoped selectors once each bridge has refreshed

#### Scenario: Models available immediately after save
- **WHEN** the user writes a provider change and opens the Default Model selector
- **THEN** models from all configured providers are listed
- **AND** no server restart is required

### Requirement: Provider save never persists the masked sentinel as an apiKey

A provider write — whether the whole-map write or a single-provider write — SHALL treat the masked sentinel value (`***`) as "keep the existing key" only when the named provider already exists in `~/.pi/agent/providers.json`. When an incoming provider's `apiKey` equals the masked sentinel but the provider is NOT present in the existing file, the write SHALL NOT persist the literal string `***` as the apiKey; it SHALL reject the write (or persist an empty key) so the credential is never corrupted to the sentinel.

#### Scenario: Masked key preserved when provider exists
- **WHEN** the existing file has `proxy` with `apiKey: "sk-real"` and the client writes `proxy` with `apiKey: "***"` and a changed `baseUrl`
- **THEN** the persisted `proxy.apiKey` SHALL remain `"sk-real"`

#### Scenario: Masked key without existing entry is not corrupted
- **WHEN** the client writes a `proxy` provider with `apiKey: "***"` and the existing file has no `proxy` entry
- **THEN** the server SHALL NOT persist `proxy.apiKey === "***"`
- **AND** the response SHALL indicate the key is required (or the entry SHALL be stored with no usable key) rather than silently writing the sentinel

## REMOVED Requirements

### Requirement: LLM-provider save rejects empty provider names
**Reason**: The Settings panel no longer holds LLM providers as a Save Bar draft source, so there is no save task that can fail and no source that can stay dirty. A blank name can no longer reach a write: the Add-provider dialog rejects it before writing, and the write path rejects a blank name in the URL segment.
**Migration**: Blank-name rejection is specified by `provider-add-flow` ("Blank custom-endpoint name is refused in the dialog") and by `custom-provider-crud` ("Blank name in the path is rejected"). The server-side guard is retained, not replaced by client validation.


