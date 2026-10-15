## MODIFIED Requirements

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
- **Sessions** [Dashboard]: `defaultModel`, `spawnStrategy`, reattach/ordering, `askUserPromptTimeoutSeconds`, `spawnRegisterTimeoutMs`, `gitWorktreeEnabled`, retry policy, pi settings (global `settings.json` editor)
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

## ADDED Requirements

### Requirement: Default model saves mirror into pi's global settings
When a Settings save carries a non-empty `provider/id` dashboard `defaultModel`, the dashboard SHALL
also write pi's global `~/.pi/agent/settings.json` `defaultProvider` (text before the
first `/`) and `defaultModel` (text after it). When a save carries a non-empty valid thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`), the
dashboard SHALL also write pi's `defaultThinkingLevel`. Clearing either dashboard value SHALL leave the
corresponding pi keys untouched. A value with no `/` SHALL skip the model mirror; the save response
SHALL report the skip as non-failing and the Settings panel SHALL show it as a non-blocking notice in the
Default Model callout. An unparseable pi settings file SHALL NOT be overwritten; that and
any other mirror failure SHALL NOT fail the dashboard config save, and the save response SHALL report
it. The Settings panel SHALL show a reported mirror failure as a non-blocking warning inside the Default
Model callout while the save itself counts as saved. A save that carries neither key SHALL NOT touch pi's file, and pi keys
already equal to the derived values SHALL NOT be rewritten.
The mirror SHALL NOT reload running sessions. Mirror writes SHALL use the same lock and atomic
replacement as the pi settings editor, and SHALL read the dashboard values to mirror from the persisted
dashboard config while holding that lock (not from the request), so overlapping config saves leave pi
matching the final dashboard value.

#### Scenario: Changing the default model updates pi's default
- **GIVEN** pi's settings contain `defaultProvider: "anthropic"`, `defaultModel: "claude-opus-5"`
- **WHEN** the user saves Default model `anthropic/claude-opus-5-5`
- **THEN** pi's settings SHALL contain `defaultProvider: "anthropic"` and `defaultModel: "claude-opus-5-5"`
- **AND** every other key in pi's settings SHALL be unchanged

#### Scenario: Model id containing a slash splits on the first slash
- **WHEN** the user saves Default model `openrouter/deepseek/deepseek-v4.1-flash`
- **THEN** pi's settings SHALL contain `defaultProvider: "openrouter"` and `defaultModel: "deepseek/deepseek-v4.1-flash"`

#### Scenario: Clearing the dashboard default leaves pi untouched
- **GIVEN** pi's settings contain `defaultModel: "claude-opus-5-5"`
- **WHEN** the user clears Default model and saves
- **THEN** pi's `defaultModel` SHALL still be `"claude-opus-5-5"`

#### Scenario: Thinking level mirrors
- **WHEN** the user saves default thinking level `high`
- **THEN** pi's settings SHALL contain `defaultThinkingLevel: "high"`

#### Scenario: Mirror failure does not fail the config save
- **GIVEN** pi's settings file cannot be written
- **WHEN** the user saves a new Default model
- **THEN** `~/.pi/dashboard/config.json` SHALL contain the new value
- **AND** the save response SHALL report the mirror failure
- **AND** the Default Model callout SHALL show a warning while the Save Bar shows the saved state

#### Scenario: Unparseable pi file is never overwritten by the mirror
- **GIVEN** `~/.pi/agent/settings.json` contains truncated JSON
- **WHEN** the user saves a new Default model
- **THEN** `~/.pi/agent/settings.json` SHALL be byte-identical to before
- **AND** the save response SHALL report a parse failure

#### Scenario: Model without a provider separator is skipped, not failed
- **WHEN** a config save sets `defaultModel` to `claude-opus-5-5` (no `/`)
- **THEN** pi's settings SHALL be unchanged
- **AND** the save response SHALL report the mirror as skipped, not failed
- **AND** the Default Model callout SHALL show a non-blocking notice

#### Scenario: Overlapping config saves converge on the final value
- **WHEN** two config saves setting Default model to `anthropic/a` and then `anthropic/b` overlap
- **THEN** after both complete, pi's `defaultModel` SHALL equal the model id in the dashboard's persisted `defaultModel`

#### Scenario: Unrelated config save does not touch pi's file
- **WHEN** the user saves a change to an unrelated setting only
- **THEN** `~/.pi/agent/settings.json` SHALL be byte-identical to before
