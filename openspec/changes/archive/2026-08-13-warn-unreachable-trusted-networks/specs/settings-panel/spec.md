## MODIFIED Requirements

### Requirement: Settings panel view
The settings panel SHALL render as a full-page view in the main content area when the route matches `/settings/:page?`. It SHALL display a fixed header (back button, title, Restart button), a navigation listing pages grouped by concern, and a content area for the active page. The header SHALL remain visible at all times regardless of scroll position. A single `SettingsPanel` instance SHALL remain mounted across page changes so unsaved edits on any page persist until Save. Persistence SHALL be driven by a dirty-gated **Save Bar** (see "Settings Save Bar"), not by a header Save button.

The navigation + content layout SHALL be responsive. The wrapper element containing the nav and the content area SHALL stack vertically on narrow (mobile) viewports and arrange side-by-side on wide (desktop, `md` breakpoint and up) viewports. On mobile the navigation SHALL render as a full-width horizontal, horizontally-scrollable tab strip positioned above the content, and the content area SHALL fill the remaining space below it with a non-zero width. On desktop the navigation SHALL render as a fixed-width vertical rail to the left of the content. At no viewport width SHALL the content area collapse to zero width or be positioned outside the visible viewport.

The panel SHALL provide these pages (nav groups in brackets):
- **General** [Dashboard]: Interface language, `dashboardName`, display preferences
- **Server** [Dashboard]: `port`, `piPort`, `autoShutdown`, `shutdownIdleSeconds`, `tunnel.enabled`, `tunnel.watchdog.*`, memory limits (`memoryLimits.*`)
- **Sessions** [Dashboard]: `defaultModel`, `spawnStrategy`, reattach/ordering, `askUserPromptTimeoutSeconds`, `spawnRegisterTimeoutMs`, `gitWorktreeEnabled`, retry policy
- **Remote Servers** [Network]: known servers, network discovery
- **Gateway** [Network]: tunnel provider and mode (self-managed save)
- **Security** [Network]: `auth.providers`, `auth.allowedUsers`, `auth.bypassUrls`, `auth.bypassHosts` (Trusted Networks)
- **Providers** [Extensions]: Provider Authentication, LLM Providers, API Proxy
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

### Requirement: Trusted Networks section on Security tab
The Security tab SHALL include a "Trusted Networks" section that edits `config.auth.bypassHosts`. The section SHALL display existing entries as individual rows with per-entry remove (✕) buttons. The section SHALL provide a "+ Add Local Network" button that opens a dropdown listing the current host's non-loopback IPv4 network interfaces (fetched from `GET /api/network-interfaces`). The dropdown SHALL render each interface's `label` rather than its raw device name, and SHALL offer that interface's `suggestions` rather than its raw `cidr`. A suggestion marked `wide` SHALL be visually distinguished from a narrow one and SHALL carry the same "grants unauthenticated access to the whole range" explanation used by the block-event trust banner.

`wide` means **broader than the reference network of the path that produced it**, not an absolute property of the range. The block-event path's reference is the exact peer address, so any derived range is wide. The interface path's reference is the interface's own netmask-derived network, so that network is narrow while any range broader than it — including the containing range offered for a `/32` point-to-point device — is wide. The same `192.168.10.0/24` is therefore narrow from an interface and wide from a block event, and neither is wrong. Because the tier alone is ambiguous across contexts, every offer SHALL state the range it grants in its label, so the user is never relying on colour to judge breadth.

When two interfaces collapse to one row, the surviving row SHALL use the `label` of the first interface in the endpoint's response order, so the collapse is deterministic. An interface with `pointToPoint: true` and no suggestion SHALL be shown as unofferable with an explanation, not as a selectable entry. The dropdown SHALL deduplicate on the suggestion **`value`**, so that two interfaces resolving to the same offer — whether two NICs on one subnet or two point-to-point devices sharing a containing range — produce a single row. Deduplication is performed by this dropdown, never by the endpoint, whose entries the listen-interface picker also consumes. The section SHALL provide a manual entry input that accepts exact IP, wildcard (e.g. `10.0.0.*`), or CIDR (e.g. `192.168.1.0/24`) formats. The section SHALL display an explicit security warning ("⚠ Anyone on a trusted network has full access to the dashboard without authentication. Only use on private networks you control."). Adding an entry SHALL write to `config.auth.bypassHosts` — never to top-level `config.trustedNetworks`. Removing an entry SHALL remove from `config.auth.bypassHosts` only.

#### Scenario: Section writes to auth.bypassHosts, not trustedNetworks
- **WHEN** the user adds `192.168.1.0/24` via the Trusted Networks section and clicks Save
- **THEN** the saved config SHALL have `auth.bypassHosts` containing `192.168.1.0/24`
- **AND** the saved config SHALL NOT have `192.168.1.0/24` added to top-level `trustedNetworks`

#### Scenario: Add Local Network dropdown populates from network interfaces
- **WHEN** the user clicks "+ Add Local Network"
- **THEN** the UI SHALL call `GET /api/network-interfaces`
- **AND** display each interface's `label` and its `suggestions` in a dropdown
- **AND** selecting a suggestion SHALL add its `value` to the list and `auth.bypassHosts`

#### Scenario: Tailscale interface offers the tailnet range, not the host
- **GIVEN** `GET /api/network-interfaces` returns a `pointToPoint` tailnet interface whose sole suggestion is the wide range `100.64.0.0/10`
- **WHEN** the user opens the Add Local Network dropdown
- **THEN** `100.97.246.31/32` SHALL NOT be offered
- **AND** `100.64.0.0/10` SHALL be offered, marked as wide
- **AND** the entry SHALL be labelled as the tailnet interface, not `utun4`

#### Scenario: Unofferable point-to-point interface is explained, not silently dropped
- **GIVEN** an interface has `pointToPoint: true` and no suggestion
- **WHEN** the user opens the Add Local Network dropdown
- **THEN** the interface SHALL be shown as unofferable with an explanation
- **AND** it SHALL NOT be selectable

#### Scenario: Same range tiered differently in the two paths
- **GIVEN** an interface at `192.168.10.123/255.255.255.0` and a block event from `192.168.10.57`
- **WHEN** both offer `192.168.10.0/24`
- **THEN** the interface path MAY mark it narrow and the block-event path MAY mark it wide
- **AND** both offers SHALL state `192.168.10.0/24` in their label

#### Scenario: One offer per suggestion value
- **GIVEN** two interfaces resolve to the same suggestion `value`
- **WHEN** the user opens the Add Local Network dropdown
- **THEN** that value SHALL appear exactly once

#### Scenario: Two point-to-point devices sharing a range collapse to one offer
- **GIVEN** two `pointToPoint` interfaces with different addresses both suggest `100.64.0.0/10`
- **WHEN** the user opens the Add Local Network dropdown
- **THEN** `100.64.0.0/10` SHALL appear exactly once

#### Scenario: Deduplication does not reach the listen-interface picker
- **GIVEN** two interfaces on one subnet with distinct addresses
- **WHEN** the user opens the Server page's listen-interface picker
- **THEN** both addresses SHALL remain selectable

#### Scenario: Manual entry accepts flexible formats
- **WHEN** the user types `10.0.0.5` (exact), `10.0.0.*` (wildcard), or `192.168.1.0/24` (CIDR) in the manual entry field and confirms
- **THEN** the UI SHALL add each entry to the list and `auth.bypassHosts`

#### Scenario: Remove entry removes only from auth.bypassHosts
- **WHEN** the user clicks the ✕ button on an entry originating from `auth.bypassHosts`
- **THEN** the UI SHALL remove the entry from `auth.bypassHosts` on save
- **AND** entries in top-level `config.trustedNetworks` SHALL remain untouched

#### Scenario: Info hint shown when top-level trustedNetworks is non-empty
- **WHEN** the loaded config has non-empty top-level `trustedNetworks` entries
- **THEN** the Trusted Networks section SHALL display an informational hint indicating additional entries exist in `config.json` under `trustedNetworks` that are also active but edited via that file

#### Scenario: No hint when top-level trustedNetworks is empty
- **WHEN** the loaded config has empty or missing top-level `trustedNetworks`
- **THEN** the informational hint SHALL NOT be displayed

## ADDED Requirements

### Requirement: Trusted Networks section hosts the bind reachability advisory

The Trusted Networks section on the Security tab SHALL render the bind reachability advisory whose condition, content, and remediation behaviour are defined by the `server-bind-host` capability. This requirement governs **placement only**; it SHALL NOT restate the advisory's triggering condition or copy, so the two capabilities cannot diverge at archive time. The advisory SHALL appear between the section description and the trusted-entry list, in the same position as the block-event trust banner. Relative ordering when both are present is governed by the `server-bind-host` capability and SHALL NOT be restated here.

#### Scenario: Advisory renders above the entry list
- **GIVEN** the bind reachability condition holds
- **WHEN** the Trusted Networks section renders
- **THEN** the advisory SHALL appear between the section description and the trusted-entry list
