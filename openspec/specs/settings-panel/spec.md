# settings-panel Specification

## Purpose

Dashboard settings UI: full-page panel rendered at `/settings`, tabbed by concern (General / Providers / Security / Advanced). Covers server config (ports, autoShutdown, spawnStrategy), OAuth providers, trusted networks, memory limits, OpenSpec polling tuning, and plugin-contributed sections.
## Requirements
### Requirement: Settings button in sidebar header
The sidebar header SHALL include a gear icon button positioned at the end of the header row (after the collapse button). Clicking the button SHALL navigate to `/settings`.

#### Scenario: Settings button visible
- **WHEN** the sidebar is rendered
- **THEN** a gear icon button SHALL be visible in the header row after the collapse button

#### Scenario: Settings button click
- **WHEN** the user clicks the gear icon button
- **THEN** the app SHALL navigate to `/settings` and the main content area SHALL show the settings panel

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

### Requirement: Canonical and legacy settings URLs
The settings panel SHALL be addressable at the canonical path `/settings/:page?` and SHALL continue to honor the legacy query form `/settings?tab=<id>` indefinitely. Resolution SHALL run inside the single mounted panel in this order: (1) a valid route `:page`; (2) a valid legacy `?tab=<id>`, which SHALL trigger a history-`replace` navigation to `/settings/<id>`; (3) otherwise default to `/settings/general` via history-`replace`. The alias map `advanced → developer` and `servers → remote` SHALL be applied before validation so old links resolve to the new page homes.

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

#### Scenario: Unknown page falls back to general
- **WHEN** the user opens `/settings/bogus`
- **THEN** the panel SHALL `replace`-navigate to `/settings/general`

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

### Requirement: Trusted Networks section removed from General tab
The General tab SHALL NOT render any Trusted Networks, Trusted Hosts, or auth-bypass control. The top-level `config.trustedNetworks` field SHALL NOT be editable via the General tab UI.

#### Scenario: General tab has no Trusted Networks section
- **WHEN** the user navigates to `/settings` and the General tab is active
- **THEN** no section titled "Trusted Networks" or similar SHALL be rendered
- **AND** no "+ Add Local Network" button SHALL be rendered on the General tab

### Requirement: Config read endpoint
The server SHALL expose `GET /api/config` returning the current dashboard configuration. The endpoint SHALL be localhost-only (use `localhostGuard`). Auth secrets and provider client secrets SHALL be redacted in the response (replaced with `"***"`).

#### Scenario: Read config
- **WHEN** a localhost `GET /api/config` request is received
- **THEN** the server SHALL return `{ success: true, data: <config> }` with secrets redacted

#### Scenario: Read config from external IP
- **WHEN** a non-localhost `GET /api/config` request is received
- **THEN** the server SHALL return 403

#### Scenario: Secret redaction
- **WHEN** config contains `auth.secret` or `auth.providers.github.clientSecret`
- **THEN** the response SHALL replace those values with `"***"`

### Requirement: Config write endpoint
The server SHALL expose `PUT /api/config` accepting a partial config object. The endpoint SHALL be localhost-only. It SHALL merge the provided fields with the existing config, write to `~/.pi/dashboard/config.json`, and apply runtime changes.

#### Scenario: Update single field
- **WHEN** `PUT /api/config` receives `{ "autoShutdown": false }`
- **THEN** the server SHALL merge with existing config, write to disk, apply the change at runtime, and return `{ success: true }`

#### Scenario: Update auth providers
- **WHEN** `PUT /api/config` receives `{ "auth": { "providers": { "github": { "clientId": "new", "clientSecret": "new" } } } }`
- **THEN** the server SHALL update auth config, rebuild provider registry, and return `{ success: true }`

#### Scenario: Preserve redacted secrets
- **WHEN** `PUT /api/config` receives `{ "auth": { "providers": { "github": { "clientId": "new", "clientSecret": "***" } } } }`
- **THEN** the server SHALL keep the existing `clientSecret` value (not overwrite with `"***"`)

#### Scenario: Fields requiring restart
- **WHEN** `PUT /api/config` changes `port` or `piPort`
- **THEN** the server SHALL save to disk, return `{ success: true, restartRequired: true }`, and NOT apply the port change at runtime

#### Scenario: External IP write attempt
- **WHEN** a non-localhost `PUT /api/config` request is received
- **THEN** the server SHALL return 403

### Requirement: Runtime config apply
After writing config to disk, the server SHALL apply changes that can take effect without restart.

#### Scenario: autoShutdown changed
- **WHEN** `autoShutdown` or `shutdownIdleSeconds` is changed
- **THEN** the server SHALL update the idle timer parameters immediately

#### Scenario: spawnStrategy changed
- **WHEN** `spawnStrategy` is changed
- **THEN** the new strategy SHALL be used for the next spawned session

#### Scenario: auth config changed
- **WHEN** `auth` section is changed
- **THEN** the server SHALL rebuild the OAuth provider registry and update the JWT secret for subsequent requests

#### Scenario: port changed
- **WHEN** `port` or `piPort` is changed
- **THEN** the server SHALL NOT attempt to rebind — the change takes effect on next server start

### Requirement: Settings form behavior
The settings panel SHALL load current config on mount via `GET /api/config`. Form fields SHALL be pre-populated with current values. A save button SHALL send changed fields via `PUT /api/config`. Success/error feedback SHALL be shown via a toast or inline message.

#### Scenario: Load settings on mount
- **WHEN** the settings panel mounts
- **THEN** it SHALL call `GET /api/config` and populate all form fields with current values

#### Scenario: Save changed settings
- **WHEN** the user modifies a field and clicks save
- **THEN** the panel SHALL send only the changed fields via `PUT /api/config`

#### Scenario: Restart required feedback
- **WHEN** the save response includes `restartRequired: true`
- **THEN** the panel SHALL display a message: "Some changes require a server restart to take effect"

#### Scenario: Save error
- **WHEN** the `PUT /api/config` request fails
- **THEN** the panel SHALL display an error message

### Requirement: Settings panel displays configurable dashboard options
The settings panel SHALL include a "Packages" section for managing globally installed pi packages. This section SHALL display the list of installed global packages with uninstall and update buttons, and a "Browse Packages" button that opens the PackageBrowser in global scope.

#### Scenario: View global packages in settings
- **WHEN** user opens the Settings panel
- **THEN** a "Packages" section shows all globally installed pi packages

#### Scenario: Browse packages from settings
- **WHEN** user clicks "Browse Packages" in the settings Packages section
- **THEN** the PackageBrowser opens in global scope for searching and installing packages

#### Scenario: Uninstall from settings
- **WHEN** user clicks "Uninstall" on an installed global package
- **THEN** the package is removed via `POST /api/packages/remove` with `scope: "global"`

#### Scenario: Update from settings
- **WHEN** user clicks "Update" on an installed global package
- **THEN** the package is updated via `POST /api/packages/update` with the package source and `scope: "global"`

### Requirement: Provider save refreshes available models
When LLM providers are saved via the Settings panel, the server SHALL broadcast a `credentials_updated` message to all connected pi sessions. This MUST cause the model registry to refresh and push updated `models_list` messages back to the dashboard client, keeping every session-scoped model selector current.

The Settings panel's **Default Model** selector SHALL NOT depend on that broadcast for its own correctness. It is sourced from the union of the session-independent `GET /api/models` catalogue and the per-session model lists, and the catalogue half is refreshed by the panel's own refetch, so the selector SHALL display the updated model list without requiring a server restart **and without requiring any connected pi session**.

#### Scenario: Saving new provider populates model selector
- **WHEN** the user adds a new LLM provider and clicks Save
- **THEN** the server broadcasts `credentials_updated` to all sessions
- **AND** each session's bridge refreshes its model registry
- **AND** each session-scoped model selector shows models from the new provider

#### Scenario: Saving new provider populates the Default Model selector
- **WHEN** the user adds a new LLM provider and clicks Save
- **THEN** the Settings panel refetches `GET /api/models`
- **AND** the Default Model selector shows models from the new provider
- **AND** this holds whether or not any pi session is connected

#### Scenario: Removing a provider updates model selector
- **WHEN** the user removes an LLM provider and clicks Save
- **THEN** models from the removed provider no longer appear in the Default Model selector, unless a live session still reports them
- **AND** they no longer appear in session-scoped selectors once each bridge has refreshed

#### Scenario: Models available immediately after save
- **WHEN** the user saves provider changes and opens the Default Model selector
- **THEN** models from all configured providers are listed
- **AND** no server restart is required

### Requirement: ask_user prompt timeout field in Sessions section
The Settings panel's Sessions page SHALL include a numeric input bound to `config.askUserPromptTimeoutSeconds`. The field SHALL accept negative integers so users can enter `-1` to disable the timeout. The control SHALL display a hint text immediately below it explaining: (a) the value is in seconds, (b) `-1` (or `0`) means “wait forever”, and (c) the default is 300 (5 minutes).

When the user changes this field, the Settings panel SHALL include `askUserPromptTimeoutSeconds` in the partial sent to `PUT /api/config`. If the user clears the field (the resulting input value is undefined / NaN), the partial SHALL fall back to the default `300` rather than silently writing `0`.

The server's `writeConfigPartial` SHALL persist the value verbatim through its existing top-level scalar merge (`{ ...existing, ...partial }`); no auth-section-style special handling is required. A subsequent `GET /api/config` SHALL return the persisted value with no redaction.

Changing this field SHALL NOT mark the save as restart-requiring — the bridge re-reads `config.askUserPromptTimeoutSeconds` on every `session_start`, so the new timeout takes effect on the next pi session reload (`/reload`) without a server restart.

#### Scenario: Field is rendered with current value
- **WHEN** the user opens `/settings` with `askUserPromptTimeoutSeconds: 600` on disk
- **THEN** the Sessions page SHALL show a numeric input populated with `600`
- **AND** the hint text below SHALL mention the `-1` / `0` infinite-wait semantics and the 300 s default

#### Scenario: User saves a custom positive value
- **WHEN** the user changes the field from `300` to `120` and clicks Save
- **THEN** the panel SHALL `PUT /api/config` with `{ "askUserPromptTimeoutSeconds": 120 }` in the partial
- **AND** the persisted `~/.pi/dashboard/config.json` SHALL contain `askUserPromptTimeoutSeconds: 120`

#### Scenario: User saves -1 for infinite wait
- **WHEN** the user enters `-1` and clicks Save
- **THEN** the panel SHALL `PUT /api/config` with `{ "askUserPromptTimeoutSeconds": -1 }`
- **AND** the persisted config SHALL contain `askUserPromptTimeoutSeconds: -1` (the negative value MUST NOT be coerced or rejected by the client-side diff)

#### Scenario: Empty-field fallback
- **WHEN** the user clears the input (browser yields NaN/undefined) and clicks Save
- **THEN** the partial SHALL contain `askUserPromptTimeoutSeconds: 300` (the default), not `0`

#### Scenario: Save does not require restart
- **WHEN** only `askUserPromptTimeoutSeconds` changes and the user clicks Save
- **THEN** the `PUT /api/config` response SHALL have `restartRequired: false`
- **AND** the panel SHALL NOT show the “Restart needed” banner

### Requirement: Config write persists auth.bypassHosts and auth.bypassUrls
The `PUT /api/config` endpoint SHALL persist `auth.bypassHosts` and `auth.bypassUrls` from the incoming partial to `~/.pi/dashboard/config.json`. The auth-section merge in `writeConfigPartial` SHALL propagate these fields using the same conditional-copy pattern already used for `allowedUsers`: when `partial.auth.bypassHosts !== undefined`, the persisted `auth.bypassHosts` SHALL equal the incoming value (including the empty array, which SHALL clear all entries); when `partial.auth.bypassHosts` is absent, the existing persisted value SHALL be preserved. The same behaviour SHALL apply to `auth.bypassUrls`.

A subsequent `GET /api/config` SHALL return the persisted `auth.bypassHosts` and `auth.bypassUrls` values, with redaction rules applied only to `auth.secret` and per-provider `clientSecret` fields (unchanged from current redaction behaviour). `bypassHosts` and `bypassUrls` SHALL NOT be redacted.

#### Scenario: PUT persists auth.bypassHosts with no pre-existing auth
- **WHEN** the config file contains no `auth` section and the client sends `PUT /api/config` with body `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }`
- **THEN** the response SHALL be `{ success: true }`
- **AND** `~/.pi/dashboard/config.json` on disk SHALL contain `auth.bypassHosts: ["192.168.1.0/24"]`
- **AND** a subsequent `GET /api/config` SHALL return `auth.bypassHosts: ["192.168.1.0/24"]`

#### Scenario: PUT persists auth.bypassHosts alongside existing providers
- **WHEN** the config file already has `auth.providers.github.clientId = "abc"` configured and the client sends `PUT /api/config` with body `{ "auth": { "bypassHosts": ["10.0.0.0/8"] } }`
- **THEN** the persisted config SHALL contain both the pre-existing `auth.providers.github` AND the new `auth.bypassHosts: ["10.0.0.0/8"]`
- **AND** the existing `auth.providers.github.clientSecret` SHALL NOT be lost

#### Scenario: PUT clears bypassHosts via empty array
- **WHEN** the config file has `auth.bypassHosts: ["192.168.1.0/24"]` and the client sends `PUT /api/config` with body `{ "auth": { "bypassHosts": [] } }`
- **THEN** the persisted `auth.bypassHosts` SHALL equal `[]`
- **AND** a subsequent `GET /api/config` SHALL return `auth.bypassHosts: []`

#### Scenario: PUT without bypassHosts preserves existing value
- **WHEN** the config file has `auth.bypassHosts: ["192.168.1.0/24"]` and the client sends `PUT /api/config` with body `{ "auth": { "allowedUsers": ["alice"] } }` (no `bypassHosts` key)
- **THEN** the persisted `auth.bypassHosts` SHALL still equal `["192.168.1.0/24"]`
- **AND** the persisted `auth.allowedUsers` SHALL equal `["alice"]`

#### Scenario: PUT persists auth.bypassUrls symmetrically
- **WHEN** the client sends `PUT /api/config` with body `{ "auth": { "bypassUrls": ["/webhooks/", "/metrics"] } }`
- **THEN** the persisted config SHALL contain `auth.bypassUrls: ["/webhooks/", "/metrics"]`
- **AND** a subsequent `GET /api/config` SHALL return the same values

#### Scenario: bypassHosts is not redacted in GET response
- **WHEN** the config file contains `auth.bypassHosts: ["192.168.1.0/24"]` and `auth.secret: "secret-value"`
- **THEN** `GET /api/config` SHALL return `auth.bypassHosts: ["192.168.1.0/24"]` (unredacted)
- **AND** `GET /api/config` SHALL return `auth.secret: "***"` (redacted, per existing rule)

### Requirement: Settings panel exposes spawn-register timeout
The Settings panel (`packages/client/src/components/SettingsPanel.tsx`) SHALL render a numeric input field for `spawnRegisterTimeoutMs` under the Sessions group (or nearest equivalent group containing other spawn-related fields). The field SHALL be labelled "Spawn register timeout (ms)" with helper text "How long to wait for a spawned pi session to connect before showing a warning. Default 30000 (30s). Range 5000–120000."

The input SHALL accept integers in the closed range `[5000, 120000]`. Out-of-range or non-numeric inputs SHALL be flagged as invalid (existing settings-form invalidation pattern) and SHALL prevent save until corrected.

On save, the value SHALL be persisted via the existing `POST /api/config` config-write path. The watchdog SHALL pick up the new value on the next spawn (read-on-arm — no server restart required).

#### Scenario: field rendered with current config value
- **WHEN** the Settings panel mounts with config `{ spawnRegisterTimeoutMs: 45000 }`
- **THEN** the input SHALL display the value `45000`

#### Scenario: in-range value saves
- **WHEN** the user enters `60000` and clicks Save
- **THEN** `POST /api/config` SHALL be called with `{ spawnRegisterTimeoutMs: 60000 }` (alongside any other dirty fields)

#### Scenario: out-of-range input rejected
- **WHEN** the user enters `1000` (below minimum)
- **THEN** the field SHALL be flagged as invalid with helper text indicating the valid range
- **AND** Save SHALL remain disabled or refuse to submit the field

#### Scenario: non-numeric input rejected
- **WHEN** the user enters `"abc"`
- **THEN** the field SHALL be flagged as invalid and Save SHALL be blocked

#### Scenario: helper text mentions default and range
- **WHEN** the field is rendered
- **THEN** the helper text SHALL include both the default value (30000 / 30s) and the valid range (5000–120000)

### Requirement: OpenSpec section exposes `openspec.enabled` toggle
The settings panel SHALL render a toggle control for `DashboardConfig.openspec.enabled` in the OpenSpec polling configuration block (currently rendered alongside `pollIntervalSeconds`, `maxConcurrentSpawns`, etc. — see `SettingsPanel.tsx` lines ~722–791). The toggle SHALL be a checkbox or switch labeled "Enable OpenSpec" (or equivalent) with help text indicating that disabling it hides all OpenSpec UI surfaces and stops background polling.

When the toggle is `false`, the other `openspec.*` polling-tuning controls (interval, concurrency, change-detection, jitter) SHALL be visually disabled (greyed out) but still display their current values, so the user can re-enable without losing tuning state.

The toggle SHALL be wired to the standard Save flow (writes through `PUT /api/config`); no separate apply button is required.

#### Scenario: Toggle present in OpenSpec settings block
- **WHEN** the user navigates to the settings tab containing the OpenSpec section
- **THEN** an "Enable OpenSpec" toggle control SHALL be visible
- **AND** the control's checked state SHALL reflect `openspec.enabled` from the loaded config

#### Scenario: Disabling toggle disables sibling controls
- **WHEN** the user unchecks the "Enable OpenSpec" toggle
- **THEN** the `pollIntervalSeconds`, `maxConcurrentSpawns`, `changeDetection`, and `jitterSeconds` inputs SHALL be visually disabled (greyed out, non-interactive)
- **AND** their values SHALL remain visible

#### Scenario: Toggle change persists via Save
- **WHEN** the user toggles "Enable OpenSpec" off and clicks Save
- **THEN** `PUT /api/config` SHALL be invoked with `{ openspec: { enabled: false } }`
- **AND** the dashboard SHALL converge to the disabled state per the `shared-config` and `server-openspec-polling` capabilities

#### Scenario: Re-enabling restores controls
- **WHEN** the user re-checks the "Enable OpenSpec" toggle
- **THEN** the sibling polling-tuning controls SHALL become interactive again
- **AND** their values SHALL be unchanged from before the disable

### Requirement: Worktree preference toggle in settings
The settings panel SHALL expose a checkbox bound to the new config field `gitWorktreeEnabled` (boolean, default `true`). Label SHALL read `Show worktree spawn buttons in folders and OpenSpec rows`. Help text SHALL clarify that this is a UI preference only — it does not disable the underlying `/api/git/worktree*` REST endpoints.

The field SHALL persist through the existing `/api/config` partial-merge write path and SHALL coexist with all other config fields without disturbing them.

#### Scenario: Default value when field absent
- **WHEN** the dashboard config on disk has no `gitWorktreeEnabled` key
- **THEN** the settings panel SHALL render the checkbox as checked (effective value `true`)

#### Scenario: Disabling persists across restarts
- **WHEN** the user unchecks the box and clicks save
- **THEN** the next read of `/api/config` SHALL return `gitWorktreeEnabled: false`
- **THEN** subsequent UI renders SHALL hide both folder `+Worktree` and OpenSpec-row `⑂+` buttons

#### Scenario: Toggle preserves other config fields
- **WHEN** the user toggles only `gitWorktreeEnabled`
- **THEN** the partial-merge write SHALL preserve every other field in the config file unchanged

### Requirement: Global display-preference PATCH SHALL use `getApiBase()`

The `DisplayPrefsSection` inside the SettingsPanel SHALL use the `getApiBase()` helper to construct the `PATCH /api/preferences/display` fetch URL, matching every other API call in `SettingsPanel.tsx`.

Using a hardcoded `/api/preferences/display` path SHALL NOT be acceptable — it breaks when the dashboard is behind a reverse proxy or uses a non-root base URL.

#### Scenario: DisplayPrefsSection fetch uses getApiBase
- **GIVEN** the dashboard is served from a non-root URL (e.g., `/dashboard/`)
- **WHEN** the user toggles a display preference in Settings → General → Chat display
- **THEN** the PATCH request goes to `<apiBase>/api/preferences/display` (not a hardcoded `/api/preferences/display`)

### Requirement: Save button applies changes

The panel SHALL persist changes via a single Save action that fans out to every dirty backing store. Each settings source (`config.json` via `PUT /api/config`, LLM providers via `PUT /api/providers`, display preferences via `PATCH /api/preferences/display`, worktree auto-init pref, OpenSpec profile via `POST /api/openspec/config`, and each plugin settings section) SHALL contribute a draft and a baseline. On Save the panel SHALL commit only sources whose draft differs from their baseline. For the `config.json` source the panel SHALL compute a field-level diff and send only changed fields. Save SHALL NOT claim cross-store atomicity: it SHALL commit each dirty source independently, re-baseline sources that succeed, and keep sources that fail in the dirty state with a Retry affordance.

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

### Requirement: Display preferences and worktree auto-init buffer into the draft

The Settings-panel display-preferences toggles and the worktree auto-init toggle SHALL buffer their edits into the Settings draft and persist only on Save. They SHALL NOT write to their endpoints on each toggle from within the Settings panel.

#### Scenario: Display toggle defers to Save
- **WHEN** the user toggles a display-preference axis in the Settings panel
- **THEN** the change SHALL be held in the draft and the Save Bar SHALL appear
- **AND** no `PATCH /api/preferences/display` SHALL be sent until the user saves

#### Scenario: Worktree auto-init defers to Save
- **WHEN** the user toggles "Initialize on worktree" in the Settings panel
- **THEN** the change SHALL be held in the draft
- **AND** `autoInitWorktreeOnSpawn` SHALL be persisted only on Save

### Requirement: OpenSpec Workflow Profile section

The Settings panel's Advanced tab SHALL include an "OpenSpec Workflow Profile" section that lets the user select the global OpenSpec profile and refresh projects. The profile selection SHALL buffer into the Settings draft and commit through the unified Save; the section SHALL NOT have its own standalone "Save profile" button.

The section SHALL contain:
- A radio group with three options: **Core**, **Expanded**, **Custom**. Selecting Core or Expanded SHALL fill the displayed workflow set with that profile's fixed list. Selecting Custom SHALL enable an 11-chip workflow multiselect (`propose, explore, new, continue, ff, apply, verify, sync, archive, bulk-archive, onboard`).
- A **warning banner** stating the change affects the global OpenSpec config for all tools on the machine.
- An **Update all projects** button that POSTs `{ all: true }` to `/api/openspec/update`.
- A **collapsible** per-cwd project list, **collapsed by default**, that lists each known cwd with a staleness badge (`up to date`, `needs update`, or `unknown`) from `/api/openspec/update-status` and a per-cwd **Update** button that POSTs `{ cwd }` to `/api/openspec/update`.

#### Scenario: Section renders in the Advanced tab
- **WHEN** the user opens Settings and selects the Advanced tab
- **THEN** an "OpenSpec Workflow Profile" section is shown with the profile radio, Update all button, and a collapsed per-cwd list
- **AND** no standalone "Save profile" button SHALL render in the section

#### Scenario: Selecting Custom reveals the workflow multiselect
- **WHEN** the user selects the Custom radio option
- **THEN** the 11-workflow multiselect becomes interactive
- **AND** selecting Core or Expanded instead disables it and fills the fixed workflow set

#### Scenario: Profile change buffers and persists via the unified Save
- **WHEN** the user picks a profile and then saves from the Save Bar
- **THEN** the client POSTs `{ profile, workflows }` to `/api/openspec/config`
- **AND** on success resets the OpenSpec config cache so session-card and composer buttons re-render

#### Scenario: Per-cwd list is collapsed by default and expandable
- **WHEN** the section first renders
- **THEN** the per-cwd project list is collapsed
- **AND** clicking the show/hide toggle expands it to reveal each cwd's staleness badge and Update button

#### Scenario: Stale projects are distinguishable

- **WHEN** the per-cwd list is expanded
- **THEN** each project shows `up to date`, `needs update`, or `unknown`
- **AND** projects needing an update expose an enabled per-cwd Update button

#### Scenario: Update all triggers a bulk update

- **WHEN** the user clicks Update all projects
- **THEN** the client POSTs `{ all: true }` to `/api/openspec/update`
- **AND** the per-cwd staleness badges refresh from `/api/openspec/update-status`

### Requirement: Capture pi session output toggle in General tab
The Settings panel General tab SHALL render a "Capture pi session output (debug)" toggle alongside the diagnostic tooling (`DiagnosticsSection` / `ToolsSection` / `SpawnFailuresSection`). The toggle SHALL be bound to `config.keeperLog.capturePiOutput`, SHALL default to off when the field is absent, and SHALL include explanatory help text noting that capture is for debugging and consumes disk. Changes SHALL be included in the save diff and persisted via the config write endpoint.

#### Scenario: Toggle reflects current config
- **WHEN** the General tab renders with `config.keeperLog.capturePiOutput === false` (or absent)
- **THEN** the "Capture pi session output (debug)" toggle SHALL be off

#### Scenario: Toggling on persists to config
- **WHEN** the user enables the toggle and saves
- **THEN** the save diff SHALL include `keeperLog.capturePiOutput: true`
- **AND** the config write endpoint SHALL persist the value

#### Scenario: Toggle placed with diagnostic tools
- **WHEN** the General tab is displayed
- **THEN** the toggle SHALL appear in the same region as the diagnostics sections, not under an unrelated section

### Requirement: LLM-provider save rejects empty provider names

When the user saves LLM providers from the Settings panel, the save SHALL NOT silently discard a provider whose `name` is empty or whitespace-only. If any LLM-provider row has a blank name, the save task for the LLM-providers source SHALL fail with a visible error message identifying the problem, and SHALL leave the LLM-providers source dirty so the user can correct it. A provider row with a non-blank name and the other fields populated SHALL be persisted normally.

#### Scenario: Blank-name provider blocks save with error
- **WHEN** the user adds an LLM provider, fills Base URL and API Key, leaves the Name blank, and clicks Save
- **THEN** the LLM-providers save task SHALL report an error indicating the provider name is required
- **AND** the provider row SHALL remain in the panel (not silently dropped)
- **AND** the LLM-providers source SHALL stay dirty

#### Scenario: Named provider saves normally
- **WHEN** the user adds an LLM provider with a non-blank Name, Base URL, and API Key, and clicks Save
- **THEN** the provider SHALL be persisted to `~/.pi/agent/providers.json`
- **AND** the LLM-providers source SHALL become clean

### Requirement: Provider save never persists the masked sentinel as an apiKey

The server `PUT /api/providers` merge SHALL treat the masked sentinel value (`***`) as "keep the existing key" only when the named provider already exists in `~/.pi/agent/providers.json`. When an incoming provider's `apiKey` equals the masked sentinel but the provider is NOT present in the existing file, the merge SHALL NOT write the literal string `***` as the apiKey; it SHALL reject the write (or persist an empty key) so the credential is never corrupted to the sentinel.

#### Scenario: Masked key preserved when provider exists
- **WHEN** the existing file has `proxy` with `apiKey: "sk-real"` and the client PUTs `proxy` with `apiKey: "***"` and a changed `baseUrl`
- **THEN** the persisted `proxy.apiKey` SHALL remain `"sk-real"`

#### Scenario: Masked key without existing entry is not corrupted
- **WHEN** the client PUTs a `proxy` provider with `apiKey: "***"` and the existing file has no `proxy` entry
- **THEN** the server SHALL NOT persist `proxy.apiKey === "***"`
- **AND** the response SHALL indicate the key is required (or the entry SHALL be stored with no usable key) rather than silently writing the sentinel

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
- **AND** the `Resources` group SHALL be distinct from the existing `Extensions` group

#### Scenario: Global-scope type page omits the scope filter
- **WHEN** the user opens the `Skills` page under Settings
- **THEN** global skills SHALL render as cards
- **AND** no `All / Local / Global` scope filter SHALL be shown

### Requirement: Plugins nav group lists enabled plugins with settings

The `plugins` entry in the settings navigation rail SHALL be expandable. Its children SHALL be exactly those plugins that are **enabled in config** AND CONTRIBUTE SETTINGS, sorted alphabetically by display name. "Contributes settings" SHALL mean the plugin registers at least one `settings-section` refs claim OR has a `settings-section` intent in the intent store — the same predicate that governs route eligibility and the activation-index affordance. `PluginRow.claims` is manifest-derived and does NOT carry intents, so a claims-only test would strand an intent-only contribution: rendered by the slot, but with no nav child and no reachable route. Each child SHALL link to `/settings/plugins/<pluginId>` and SHALL display a status dot reflecting the plugin's health (`loaded`, `not loaded`, `error`).

Membership SHALL key on the plugin's `enabled` flag, NOT on `loaded`. A plugin that is enabled but failed to load, or has unsatisfied requirements, SHALL remain listed.

A disabled plugin SHALL NOT appear as a nav child. It SHALL remain reachable from the plugin activation index, which SHALL indicate that the plugin is absent from the navigation because it is disabled.

#### Scenario: Enabled plugin with settings is listed
- **WHEN** plugin `roles` is enabled and claims `settings-section`
- **THEN** the `Plugins` nav group SHALL contain a `Roles` child linking to `/settings/plugins/roles`

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
- **WHEN** the user is on `/settings/plugins/roles`
- **THEN** exactly one nav entry SHALL be marked active: the `Roles` child
- **AND** the parent `Plugins` entry SHALL NOT be marked active

#### Scenario: The parent entry is active only on the index
- **WHEN** the user is on `/settings/plugins`
- **THEN** the parent `Plugins` entry SHALL be marked active
- **AND** no child SHALL be marked active

### Requirement: Shared settings field components carry an accessible name and description

The four shared settings field components in `SettingsPanel.tsx` (`ToggleField`, `SelectField`, `NumberField`, `TextField`) SHALL each:

- associate their `<label>` with their control via `htmlFor`/`id` using generated ids, so the control has an accessible name;
- accept a **required** `hint` prop of type `React.ReactNode`, render it below the control row when non-null, and reference it from the control via `aria-describedby`;
- accept an optional `unit` string, rendered inside the `<label>` element so it forms part of the accessible name.

A `hint` of `null` SHALL be permitted and SHALL suppress both the hint element and the `aria-describedby` attribute. `null` is reserved for controls whose label is a term of art from an external specification (for example OAuth `Client ID`, `Client Secret`, `Issuer URL`).

Because `hint` is required, a call site that omits it SHALL fail type-checking. No separate allowlist file or source-scanning test is used.

This requirement is scoped to those four components. Bespoke controls rendered inline in `SettingsPanel.tsx`, field components belonging to sibling sections (`RetrySettingsSection`, `ModelProxySection`, `ToolsSection`, `DiagnosticsSection`), and plugin-contributed sections are OUT of scope.

#### Scenario: Control has an accessible name from its label
- **WHEN** a `NumberField` is rendered with label `Session register timeout`
- **THEN** the control's accessible name SHALL be `Session register timeout`

#### Scenario: Unit is part of the accessible name
- **WHEN** a `NumberField` is rendered with `unit="ms"`
- **THEN** the unit SHALL appear inside the label element and form part of the control's accessible name
- **AND** the label text SHALL NOT contain a parenthetical `(ms)`

#### Scenario: Hint becomes the accessible description
- **WHEN** a `ToggleField` is rendered with a non-null `hint`
- **THEN** the hint SHALL be visible below the control row
- **AND** the control's `aria-describedby` SHALL resolve to the element containing that hint

#### Scenario: Null hint suppresses the description
- **WHEN** a field is rendered with `hint={null}`
- **THEN** no hint element SHALL render
- **AND** the control SHALL NOT carry an `aria-describedby` attribute

#### Scenario: Omitting the prop fails the build
- **WHEN** a call site of one of the four components omits the `hint` prop
- **THEN** type-checking SHALL fail

### Requirement: Bespoke settings controls keep their validation

A control rendered inline in `SettingsPanel.tsx` rather than through one of the four shared components SHALL NOT be replaced by a shared component as part of a presentation or copy change. Specifically, the `spawnRegisterTimeoutMs` control SHALL retain its bounds check that blocks out-of-range writes and disables the Save button.

#### Scenario: Out-of-range spawn timeout still blocks Save
- **WHEN** the user enters a `spawnRegisterTimeoutMs` value below 5000 or above 120000
- **THEN** the value SHALL NOT be written to the pending config
- **AND** an inline error SHALL render
- **AND** the Save control SHALL be disabled

### Requirement: Default model is the first control on the Sessions page

The Sessions page SHALL render the `defaultModel` control as the first control on the page, inside a callout styled with `--severity-info-*` tokens. The callout SHALL carry a description stating that the default model applies only to brand-new sessions and that a resumed session keeps the model it was started with.

#### Scenario: Default model renders first
- **WHEN** the Sessions page is rendered
- **THEN** the `defaultModel` control SHALL precede every other control on the page in DOM order

#### Scenario: Brand-new-only caveat is surfaced
- **WHEN** the `defaultModel` callout is rendered
- **THEN** its description SHALL state that the setting applies only to brand-new sessions

### Requirement: One control per display preference

Each `displayPrefs` field SHALL have exactly one control across the entire settings panel, committed through the `display-prefs` draft source. No settings page SHALL render a second control for a field already owned by `DisplayPrefsSection`.

#### Scenario: Debug events has a single control
- **WHEN** the settings panel is rendered across all pages
- **THEN** exactly one control for `displayPrefs.debugTools` SHALL exist

#### Scenario: Debug events commits through the draft source
- **WHEN** the user toggles the debug-events control
- **THEN** the change SHALL be buffered and SHALL mark the General page dirty
- **AND** it SHALL persist only on Save, not on toggle

### Requirement: Chat display preferences are a single section on General

Chat-display preferences SHALL be rendered on the **General** page only, split into three sub-sections: message-level elements, reasoning, and tool calls, all registering a single `display-prefs` draft source. The reasoning auto-collapse and keep-open controls SHALL be indented beneath the reasoning toggle that gates them.

The Developer page SHALL NOT render a chat-display section.

#### Scenario: One chat-display section exists
- **WHEN** the settings panel is rendered
- **THEN** exactly one section governing chat-display preferences SHALL exist, and it SHALL be on the General page

#### Scenario: Split sections share one draft source
- **WHEN** any chat-display control is edited
- **THEN** exactly one draft source (`display-prefs`) SHALL report dirty
- **AND** the Save Bar SHALL show a single General chip, not one per sub-section

#### Scenario: Reasoning dependents are nested
- **WHEN** the reasoning sub-section is rendered
- **THEN** the auto-collapse and keep-open controls SHALL be indented beneath the reasoning toggle

### Requirement: OAuth redirect base input on the Security page
The Security page SHALL provide an input writing `auth.redirectBaseUrl` through the existing `PUT /api/config` path, with help text stating (a) that the value is the public origin the provider calls back to and (b) that the identical callback URL must also be registered with the OAuth provider — the config field alone is not sufficient.

An empty input SHALL be sent as an explicit empty string, which clears the override. Omitting the key from the write would PRESERVE the previous value instead, so the cleared state SHALL NOT be expressed by omission.

#### Scenario: Operator sets the redirect base
- **WHEN** the operator enters `https://pi.example.com` on the Security page and saves
- **THEN** the persisted config SHALL contain `auth.redirectBaseUrl: "https://pi.example.com"` and the next `GET /auth/start/:provider` SHALL emit that base in `redirect_uri`

#### Scenario: Operator clears the redirect base
- **WHEN** the operator empties the input and saves
- **THEN** the write SHALL carry `auth.redirectBaseUrl: ""` and redirect resolution SHALL fall back to the tunnel URL, or `http://localhost:{port}` when no tunnel is active

### Requirement: Notify-level control on the General chat-display section

The chat-display section on the **General** page SHALL render exactly one
control for `displayPrefs.notifyMinLevel`, committed through the existing
`display-prefs` draft source like every other chat-display field. It SHALL be a
4-value selector (`all` / `success` / `warnings` / `errors`), not a toggle, and
SHALL belong to the message-level sub-section.

The per-session chat View popover SHALL expose the same field. That popover
renders boolean rows only today; it SHALL gain a value-selecting row variant
that participates in the existing override-marking and clear-override behavior.

The variant SHALL reuse the popover's existing override plumbing rather than a
parallel path: the same patch callback, widened to carry a string value, and
the same generic overridden-vs-global comparison. Selecting a value equal to
the current global SHALL record an explicit override rather than silently
clearing it, so that a later change to the global does not move the session.

#### Scenario: Single control across the panel
- **WHEN** the settings panel is rendered across all pages
- **THEN** exactly one control for `displayPrefs.notifyMinLevel` SHALL exist
- **AND** it SHALL be on the General page

#### Scenario: Commits through the draft source
- **WHEN** the user changes the notify-level control
- **THEN** the change SHALL be buffered and SHALL mark the General page dirty
- **AND** it SHALL persist only on Save, not on change

#### Scenario: Selecting the global's own value still overrides
- **GIVEN** global `notifyMinLevel = "warnings"` and no session override
- **WHEN** the user selects `"warnings"` for that session in the popover
- **THEN** an explicit session override of `"warnings"` SHALL be recorded
- **AND** a later change of the global to `"all"` SHALL leave that session at `"warnings"`
- **AND** the clear-override action SHALL still return the session to the global

#### Scenario: Popover row marks an override
- **GIVEN** global `notifyMinLevel = "all"`
- **WHEN** the user selects `"warnings"` for one session in the chat View popover
- **THEN** that row SHALL render its overridden marker
- **AND** the popover's clear-override action SHALL restore the session to `"all"`

### Requirement: Trusted Networks section hosts the bind reachability advisory

The Trusted Networks section on the Security tab SHALL render the bind reachability advisory whose condition, content, and remediation behaviour are defined by the `server-bind-host` capability. This requirement governs **placement only**; it SHALL NOT restate the advisory's triggering condition or copy, so the two capabilities cannot diverge at archive time. The advisory SHALL appear between the section description and the trusted-entry list, in the same position as the block-event trust banner. Relative ordering when both are present is governed by the `server-bind-host` capability and SHALL NOT be restated here.

#### Scenario: Advisory renders above the entry list
- **GIVEN** the bind reachability condition holds
- **WHEN** the Trusted Networks section renders
- **THEN** the advisory SHALL appear between the section description and the trusted-entry list

### Requirement: Default Model options are the union of the server catalogue and session models

The Settings panel SHALL source the Default Model selector's options from the union of:

1. the server's session-independent model catalogue, fetched from `GET /api/models` without the
   `annotated` query parameter, and
2. every per-session `models_list` the client holds.

The union SHALL be deduplicated by fully-qualified `"provider/id"`. When the same
`"provider/id"` is present in both, the **session-supplied entry SHALL be used**, because it
carries display name and capability-confidence fields the catalogue rows do not.

The selector SHALL be fully usable when no pi session is connected, in which case the union is
the catalogue alone.

#### Scenario: Selector is populated with zero live sessions
- **GIVEN** no pi session is connected to the dashboard
- **AND** `GET /api/models` returns a non-empty catalogue
- **WHEN** the user opens Settings and views the Default Model control
- **THEN** the selector SHALL list every model from the catalogue
- **AND** the user SHALL be able to select one and save it as `defaultModel`

#### Scenario: Union is a superset of the session-only list
- **GIVEN** `GET /api/models` returns model A
- **AND** the only connected session pushed a `models_list` containing model B
- **WHEN** the Default Model selector is rendered
- **THEN** it SHALL list both A and B

#### Scenario: Session entry wins on collision
- **GIVEN** `GET /api/models` returns a row for `openai/gpt-5` with no `name`
- **AND** a connected session pushed a `models_list` entry for `openai/gpt-5` with `name` `"GPT-5"` and `metadataSource` `"catalog"`
- **WHEN** the Default Model selector is rendered
- **THEN** exactly one `openai/gpt-5` option SHALL be listed
- **AND** that option SHALL carry `name` `"GPT-5"` and `metadataSource` `"catalog"`

#### Scenario: Env-credentialed models remain reachable
- **GIVEN** a provider whose credential exists only as an environment variable, so `GET /api/models` does not list its models
- **AND** a connected session pushed a `models_list` containing those models
- **WHEN** the Default Model selector is rendered
- **THEN** those models SHALL be listed

### Requirement: Model proxy editors are sourced from the catalogue alone

The Settings panel SHALL supply `ModelProxySection` — its preferred-models editor, model-aliases
editor, and availability indicators — with the `GET /api/models` catalogue **only**, not the
union defined above. These controls configure what the model proxy routes, and the catalogue is
the proxy's routable set by construction.

#### Scenario: Proxy editors exclude a session-only model
- **GIVEN** a model is present in a session's `models_list` but absent from `GET /api/models`
- **WHEN** the model proxy preferred-models and aliases editors are rendered
- **THEN** that model SHALL NOT be offered
- **AND** the Default Model selector SHALL still offer it

#### Scenario: Proxy editors are populated with zero live sessions
- **GIVEN** no pi session is connected
- **AND** `GET /api/models` returns a non-empty catalogue
- **WHEN** the model proxy editors are rendered
- **THEN** they SHALL offer every model from the catalogue

### Requirement: Catalogue rows are projected by a single shared pure mapper

Catalogue rows SHALL be projected to the client `ModelInfo` shape by one shared pure mapper,
which SHALL:

- take `provider` from the row's own `provider` field, and derive the bare `id` by stripping the
  leading `"<provider>/"` prefix from the row's `id` — it SHALL NOT determine the provider by
  splitting the row id;
- set `vision` to `input?.includes("image")`, preserving `undefined` when the row carries no
  `input` (the route omits `input` when falsy), and SHALL NOT throw on such a row;
- pass `reasoning` and `contextWindow` through unchanged;
- **omit** `metadataSource`, because the wire row does not distinguish authored capabilities from
  registry-floored defaults;
- drop `thinkingLevelMap`, `maxTokens`, and `cost`, and SHALL NOT derive `supportedThinkingLevels`.

#### Scenario: Full row projection
- **GIVEN** a catalogue row `{ id: "openai/gpt-5", provider: "openai", reasoning: true, input: ["text","image"], contextWindow: 400000, maxTokens: 128000, thinkingLevelMap: {...}, cost: {...} }`
- **WHEN** the row is mapped
- **THEN** the result SHALL be `{ provider: "openai", id: "gpt-5", reasoning: true, vision: true, contextWindow: 400000 }`
- **AND** the result SHALL NOT carry `metadataSource`, `supportedThinkingLevels`, `thinkingLevelMap`, `maxTokens`, or `cost`

#### Scenario: Row with no input field does not throw
- **GIVEN** a catalogue row that carries no `input` property
- **WHEN** the row is mapped
- **THEN** the mapper SHALL return a result whose `vision` is `undefined`
- **AND** it SHALL NOT throw

#### Scenario: Text-only model maps to vision false
- **GIVEN** a catalogue row whose `input` is `["text"]`
- **WHEN** the row is mapped
- **THEN** `vision` SHALL be `false`

#### Scenario: Model id containing a slash
- **GIVEN** a catalogue row with `provider` `"openrouter"` and `id` `"openrouter/meta-llama/llama-3-70b"`
- **WHEN** the row is mapped
- **THEN** `provider` SHALL be `"openrouter"` and `id` SHALL be `"meta-llama/llama-3-70b"`

#### Scenario: Provider name containing a slash
- **GIVEN** a catalogue row with `provider` `"my/proxy"` and `id` `"my/proxy/some-model"`
- **WHEN** the row is mapped
- **THEN** `provider` SHALL be `"my/proxy"` and `id` SHALL be `"some-model"`

### Requirement: Catalogue refetches after a credential change made from Settings

The Settings panel SHALL own an explicit catalogue-refetch action and SHALL invoke it after each
of the following succeeds: an API-key save, a custom-provider save or removal, and an OAuth or
device-code authorization completion. Invoking it SHALL re-issue `GET /api/models` and re-render
both the Default Model selector and the model proxy editors, without a page reload, a server
restart, or any connected pi session.

Because the server's registry refresh is asynchronous and not awaited by those endpoints, a
refetch MAY observe the pre-refresh catalogue. The refetch SHALL therefore be triggered by the
originating request's success response and SHALL NOT be implemented as a fixed delay.

#### Scenario: Saving an API key surfaces its models with no session connected
- **GIVEN** no pi session is connected
- **AND** the Default Model selector lists no models of provider `P`
- **WHEN** the user saves an API key for provider `P` and the request succeeds
- **THEN** the panel SHALL issue a new `GET /api/models`
- **AND** the selector SHALL list provider `P`'s models once that response reflects the credential

#### Scenario: OAuth completion refetches the catalogue
- **GIVEN** the user completes an OAuth or device-code authorization for provider `P` from Settings
- **WHEN** the authorization completes successfully
- **THEN** the panel SHALL issue a new `GET /api/models`

#### Scenario: Removing a provider drops its models
- **GIVEN** the Default Model selector lists models of custom provider `Q`
- **WHEN** the user removes provider `Q` and the save succeeds
- **THEN** the panel SHALL refetch the catalogue
- **AND** provider `Q`'s models SHALL NOT be listed, unless a live session still reports them

#### Scenario: Refetch is not a timed guess
- **WHEN** the panel refetches after a credential write
- **THEN** the refetch SHALL be triggered by that write's success response
- **AND** it SHALL NOT be triggered by a fixed delay

### Requirement: Catalogue fetch has a loading state, a bounded timeout, and a defined concurrency rule

The Settings panel SHALL render an explicit loading state for the Default Model control while a
catalogue request is in flight. The loading state SHALL be distinguishable from both a resolved
empty catalogue and the catalogue-unavailable callout.

The catalogue request SHALL be bounded by a client timeout of 10 seconds. On expiry the panel
SHALL render the catalogue-unavailable callout rather than remaining in the loading state
indefinitely.

When more than one catalogue request is in flight, the panel SHALL apply **last-response-wins**:
the most recently received response replaces the rendered catalogue, regardless of request order.
A stale response MAY therefore transiently replace fresher data; this is corrected by the next
refetch and SHALL NOT be treated as a defect.

#### Scenario: Loading state on a cold first fetch
- **GIVEN** the Settings panel has issued `GET /api/models` and no response has arrived
- **WHEN** the Default Model control is rendered
- **THEN** a loading state SHALL be shown
- **AND** neither the empty state nor the catalogue-unavailable callout SHALL be shown

#### Scenario: Loading state clears on success
- **GIVEN** the Default Model control is in its loading state
- **WHEN** `GET /api/models` responds `200` with a non-empty list
- **THEN** the loading state SHALL be replaced by the model options

#### Scenario: Hung request times out into the unavailable callout
- **GIVEN** `GET /api/models` has not responded
- **WHEN** 10 seconds elapse since the request was issued
- **THEN** the catalogue-unavailable callout SHALL be shown
- **AND** the loading state SHALL NOT persist

#### Scenario: Out-of-order responses resolve last-response-wins
- **GIVEN** refetch R1 is issued, then refetch R2 is issued
- **WHEN** R2's response arrives first and R1's response arrives second
- **THEN** the rendered catalogue SHALL be the one carried by R1's response

### Requirement: Catalogue-unavailable renders as a callout beside the Default Model control

When the catalogue request fails — `503` with code `MODEL_PROXY_RUNTIME_MISSING`, any other
non-2xx status, or a network failure — the Settings panel SHALL render an explicit callout
adjacent to the Default Model control stating that the model catalogue could not be loaded. The
callout SHALL be rendered by the Settings panel itself and SHALL NOT require the model selector
popover to be openable.

A successful response carrying an empty list SHALL NOT render this callout.

#### Scenario: pi-ai unresolvable
- **GIVEN** `GET /api/models` responds `503 { code: "MODEL_PROXY_RUNTIME_MISSING" }`
- **WHEN** the Sessions settings page is rendered
- **THEN** a catalogue-unavailable callout SHALL be shown beside the Default Model control

#### Scenario: Network failure is also surfaced
- **GIVEN** `GET /api/models` fails with a network error
- **WHEN** the Sessions settings page is rendered
- **THEN** the catalogue-unavailable callout SHALL be shown

#### Scenario: Empty catalogue is not an error
- **GIVEN** `GET /api/models` responds `200` with an empty `data` array
- **WHEN** the Sessions settings page is rendered
- **THEN** the catalogue-unavailable callout SHALL NOT be shown

#### Scenario: Session models still offered when the catalogue is unavailable
- **GIVEN** `GET /api/models` fails
- **AND** a connected session pushed a non-empty `models_list`
- **WHEN** the Default Model selector is rendered
- **THEN** it SHALL still offer that session's models

### Requirement: Default thinking level control paired with the default model

The Sessions page SHALL render a thinking-level control inside the same
`--severity-info-*` callout that hosts the `defaultModel` control, positioned
beside the Default Model selector. The control SHALL be bound to
`config.defaultThinkingLevel`. When the user changes it, the Settings panel SHALL
include `defaultThinkingLevel` in the partial sent to `PUT /api/config`.

The control's selectable levels SHALL be derived from the currently selected
Default Model's supported thinking levels (the same `supportedThinkingLevels`
source used elsewhere in the client). When the selected Default Model changes, the
selectable levels SHALL re-derive from the newly selected model.

When **no** Default Model is selected, the control SHALL be locked to `off`: it
renders and displays `off`, and no other level is selectable. In this locked
state any selection interaction SHALL be a no-op for persistence — it SHALL NOT
add `defaultThinkingLevel` to the `PUT /api/config` partial and SHALL NOT write
`"off"`. The persisted `defaultThinkingLevel` SHALL remain `""` (empty — "do not
override"), never a spurious `off` override.

#### Scenario: Control renders beside the default model

- **WHEN** the Sessions page is rendered with a Default Model selected
- **THEN** a thinking-level control SHALL appear inside the Default Model callout beside the Default Model selector

#### Scenario: Levels filter to the selected model

- **WHEN** a Default Model with a limited set of supported thinking levels is selected
- **THEN** the thinking-level control SHALL offer only that model's supported levels

#### Scenario: Levels re-derive when the default model changes

- **WHEN** the user changes the Default Model to a different model
- **THEN** the thinking-level control's selectable levels SHALL re-derive from the newly selected model

#### Scenario: Locked to off when no model is selected

- **WHEN** the Sessions page is rendered with no Default Model selected
- **THEN** the thinking-level control SHALL display `off`
- **AND** no level other than `off` SHALL be selectable
- **AND** interacting with the locked control SHALL NOT persist any value
- **AND** the persisted `defaultThinkingLevel` SHALL remain an empty string

#### Scenario: Selecting a level persists it

- **WHEN** the user selects a supported thinking level with a Default Model selected
- **THEN** the Settings panel SHALL include `defaultThinkingLevel` set to that level in the partial sent to `PUT /api/config`

### Requirement: Memory Limits section exposes `maxReplayEvents`

The Memory Limits section of the settings panel SHALL expose a numeric control for `memoryLimits.maxReplayEvents`, alongside the existing memory-limit controls, with a hint explaining that `0` disables the bound and that earlier history remains loadable on demand.

#### Scenario: Control renders with the configured value

- **WHEN** the settings panel loads with `maxReplayEvents` set to `500`
- **THEN** the Memory Limits section SHALL display a control showing `500`

#### Scenario: Control renders the default when the field is absent

- **WHEN** the settings panel loads a config with no `maxReplayEvents`
- **THEN** the control SHALL display the positive default window the server applies

#### Scenario: Edited value is written back

- **WHEN** the user changes the control to `500` and saves
- **THEN** the config write SHALL include `memoryLimits.maxReplayEvents` of `500`
- **AND** the other `memoryLimits` values SHALL be preserved on disk

Note: preserved, not re-written. The write carries only the CHANGED fields and
the server deep-merges them over the raw config file, so an untouched sibling
keeps whatever the file holds — including an absent key, which a whole-object
write would have materialized into an explicit value the user never chose.

#### Scenario: Change is marked as requiring a restart

- **WHEN** the user changes the control
- **THEN** the panel SHALL indicate the change requires a server restart, consistent with the other Memory Limits controls

### Requirement: The `maxReplayEvents` control is localized

The control's label and hint SHALL be provided through the translation layer with an English fallback, consistent with the sibling Memory Limits controls.

#### Scenario: Label resolves in each supported locale

- **WHEN** the settings panel renders in a supported locale
- **THEN** the control's label SHALL resolve through the translation layer rather than a hard-coded string

### Requirement: Memory Limits documents the replay-window and retention interaction

The Memory Limits section SHALL carry unconditional help text explaining that event retention bounds what the replay window's elided middle can later serve. It SHALL NOT gate that text on a comparison between `maxReplayEvents` and `maxEventsPerSession`, because whether retention will actually trim the gap depends on a session's eventual size and is not decidable from configuration.

#### Scenario: Help text is always present

- **WHEN** the Memory Limits section renders
- **THEN** the interaction between the replay window and event retention SHALL be explained

#### Scenario: No conditional warning is shown

- **WHEN** `maxReplayEvents` and `maxEventsPerSession` are both positive in any relative ordering
- **THEN** no warning specific to that pairing SHALL be displayed

#### Scenario: Saving is never blocked on the pairing

- **WHEN** the user saves any combination of the two values
- **THEN** the save SHALL NOT be blocked
- **AND** neither value SHALL be rewritten on the basis of the other
- **AND** the existing minimum-replay-window clamp SHALL continue to apply unchanged

#### Scenario: Help text is localized

- **WHEN** the Memory Limits section renders in a supported locale
- **THEN** the help text SHALL resolve through the translation layer rather than a hard-coded string

### Requirement: Saving an unrelated Memory Limits field does not pin `maxReplayEvents`

The settings panel SHALL NOT convert a defaulted `maxReplayEvents` into an explicitly configured one as a side effect of editing a different field. Because the config read returns a parsed config in which the field is always materialized, a whole-object write of `memoryLimits` would persist a value the user never chose.

#### Scenario: Editing a sibling field does not persist the default

- **WHEN** the user edits a different Memory Limits field and saves, having never touched `maxReplayEvents`
- **THEN** the written config SHALL NOT gain an explicit `maxReplayEvents` that the stored config did not already have

#### Scenario: An explicitly configured value survives a sibling edit

- **WHEN** the stored config sets `maxReplayEvents` to `0` and the user edits a different Memory Limits field and saves
- **THEN** the written config SHALL still set `maxReplayEvents` to `0`

#### Scenario: The control displays the effective value

- **WHEN** the settings panel loads a config with no stored `maxReplayEvents`
- **THEN** the control SHALL display the positive default window the server applies

### Requirement: Memory Limits section exposes `replayWindowMode`

The Memory Limits section SHALL expose a control for `memoryLimits.replayWindowMode` alongside the `maxReplayEvents` control, offering both `head-tail` and `tail-only`. Its hint SHALL state the tradeoff — that `tail-only` omits the session's opening messages from the initial view — and SHALL state that the setting applies to every client of this server, not to this browser alone.

#### Scenario: Control reflects the configured mode

- **WHEN** the settings panel loads with `replayWindowMode` set to `tail-only`
- **THEN** the Memory Limits section SHALL display a control showing `tail-only`

#### Scenario: Default is shown when the field is absent

- **WHEN** the settings panel loads a config with no `replayWindowMode`
- **THEN** the control SHALL display `head-tail`

#### Scenario: Saving preserves sibling memory limits

- **WHEN** the user changes only `replayWindowMode` and saves
- **THEN** the config write SHALL include the new `memoryLimits.replayWindowMode`
- **AND** the other `memoryLimits` values SHALL be written unchanged

#### Scenario: The control is inert while windowing is off

- **WHEN** `maxReplayEvents` is `0`
- **THEN** the panel SHALL indicate that the window mode has no effect until a positive window is configured

#### Scenario: Change requires a restart

- **WHEN** the user changes `replayWindowMode`
- **THEN** the panel SHALL indicate the change requires a server restart, consistent with the other Memory Limits controls

#### Scenario: Scope is stated, not implied

- **WHEN** the `replayWindowMode` control is displayed
- **THEN** its hint SHALL state that the setting affects every client connected to this server

### Requirement: The `replayWindowMode` control is localized

The control's label, its option labels, and its hint SHALL be provided through the translation layer with an English fallback, in every language the dashboard ships, consistent with the sibling Memory Limits controls.

#### Scenario: Strings resolve through the translation layer

- **WHEN** the panel renders the `replayWindowMode` control in a supported non-English language
- **THEN** the label, option labels, and hint SHALL render from that language's catalog
- **AND** a missing key SHALL fall back to the English string rather than to a raw key

### Requirement: Reasoning sub-controls SHALL be grouped and visible when reasoning is off
The View settings page SHALL group the reasoning sub-controls (auto-collapse delay, keep-open-until-turn-ends, inline flow) together under the reasoning toggle inside the existing gated group. When `reasoning` is off, the sub-controls SHALL remain visible in a disabled state rather than being hidden, so the controls are discoverable. The `reasoningInlineFlow` toggle SHALL join this group and SHALL be disabled when `reasoning` is off.

#### Scenario: Sub-controls visible but disabled when reasoning is off
- **WHEN** `reasoning` is `false` on the View settings page
- **THEN** the auto-collapse, keep-open-until-turn-ends, and inline-flow controls SHALL all render (not be hidden) in a disabled state

#### Scenario: Sub-controls enabled when reasoning is on
- **WHEN** `reasoning` is `true` on the View settings page
- **THEN** the three reasoning sub-controls SHALL render enabled and reflect the effective preference values

### Requirement: Custom-entry fallback control on the View page
The View settings page SHALL provide a toggle for the `customEntryFallback` preference, placed with the extension-visibility controls (adjacent to the extension-notifications control). The toggle SHALL honor the global and per-session override plumbing, including the View popover's instant-apply semantics when surfaced there.

#### Scenario: Toggling the fallback applies to the chat
- **WHEN** the user toggles the custom-entry fallback control
- **THEN** the preference SHALL persist per the global/override draft-source rules
- **AND** custom-entry rows in the open session SHALL appear or disappear accordingly

