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
The settings panel SHALL render as a full-page view in the main content area when the route matches `/settings/:page?`. It SHALL display a fixed header (back button, title, Restart button), a navigation listing pages grouped by concern, and a content area for the active page. The header SHALL remain visible at all times regardless of scroll position. A single `SettingsPanel` instance SHALL remain mounted across page changes so unsaved edits on any page persist until Save. Persistence SHALL be driven by a dirty-gated **Save Bar** (see "Settings Save Bar"), not by a header Save button.

The navigation + content layout SHALL be responsive. The wrapper element containing the nav and the content area SHALL stack vertically on narrow (mobile) viewports and arrange side-by-side on wide (desktop, `md` breakpoint and up) viewports. On mobile the navigation SHALL render as a full-width horizontal, horizontally-scrollable tab strip positioned above the content, and the content area SHALL fill the remaining space below it with a non-zero width. On desktop the navigation SHALL render as a fixed-width vertical rail to the left of the content. At no viewport width SHALL the content area collapse to zero width or be positioned outside the visible viewport.

The panel SHALL provide these pages (nav groups in brackets):
- **General** [Dashboard]: Interface language, display preferences
- **Server** [Dashboard]: `port`, `piPort`, `autoShutdown`, `shutdownIdleSeconds`, `tunnel.enabled`, memory limits (`memoryLimits.*`)
- **Sessions** [Dashboard]: `spawnStrategy`, `defaultModel`, reattach/ordering, `askUserPromptTimeoutSeconds`, `spawnRegisterTimeoutMs`, `gitWorktreeEnabled`, `dashboardName`
- **Remote Servers** [Network]: known servers, network discovery
- **Security** [Network]: `auth.providers`, `auth.allowedUsers`, `auth.bypassUrls`, `auth.bypassHosts` (Trusted Networks)
- **Providers** [Extensions]: Provider Authentication, LLM Providers, API Proxy
- **Packages** [Extensions]: installed pi packages
- **Plugins** [Extensions]: plugin activation + inline settings
- **OpenSpec** [Extensions]: `openspec.enabled` polling tuning, OpenSpec Workflow Profile
- **Developer** [Advanced]: Diagnostics, Tools, Spawn Failures, `devBuildOnReload`, editor, chat-display debug events, capture-pi-output

The General page SHALL be the default when no page is specified. Each settings section SHALL render on exactly one page (no duplicate renders across pages).

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
the global-scope per-type resource card grids. The plugin `settings-section`
slot SHALL continue to target a page via its `tab` field, defaulting to
`general` when unset. Each settings page SHALL mount `<SettingsSectionSlot
tab={page} />` so plugin claims render on their targeted page. Claims targeting
an id outside the enumerated set SHALL be treated as `general`.

#### Scenario: Unset claim lands on General
- **WHEN** a plugin registers a `settings-section` claim with no `tab`
- **THEN** the claim SHALL render on the General page

#### Scenario: Claim targets a new page id
- **WHEN** a plugin registers a `settings-section` claim with `tab: "developer"`
- **THEN** the claim SHALL render on the Developer page

#### Scenario: Third-party claim with unknown id falls back
- **WHEN** a plugin registers a `settings-section` claim with an id not in `VALID_SETTINGS_TABS`
- **THEN** the claim SHALL render on the General page

#### Scenario: Resource page ids resolve
- **WHEN** the user navigates to `/settings/agents`
- **THEN** the panel SHALL render the global-scope Agents resource card grid

### Requirement: Trusted Networks section on Security tab
The Security tab SHALL include a "Trusted Networks" section that edits `config.auth.bypassHosts`. The section SHALL display existing entries as individual rows with per-entry remove (✕) buttons. The section SHALL provide a "+ Add Local Network" button that opens a dropdown listing the current host's non-loopback IPv4 network interfaces in CIDR form (fetched from `GET /api/network-interfaces`). The section SHALL provide a manual entry input that accepts exact IP, wildcard (e.g. `10.0.0.*`), or CIDR (e.g. `192.168.1.0/24`) formats. The section SHALL display an explicit security warning ("⚠ Anyone on a trusted network has full access to the dashboard without authentication. Only use on private networks you control."). Adding an entry SHALL write to `config.auth.bypassHosts` — never to top-level `config.trustedNetworks`. Removing an entry SHALL remove from `config.auth.bypassHosts` only.

#### Scenario: Section writes to auth.bypassHosts, not trustedNetworks
- **WHEN** the user adds `192.168.1.0/24` via the Trusted Networks section and clicks Save
- **THEN** the saved config SHALL have `auth.bypassHosts` containing `192.168.1.0/24`
- **AND** the saved config SHALL NOT have `192.168.1.0/24` added to top-level `trustedNetworks`

#### Scenario: Add Local Network dropdown populates from network interfaces
- **WHEN** the user clicks "+ Add Local Network"
- **THEN** the UI SHALL call `GET /api/network-interfaces`
- **AND** display the returned CIDR entries in a dropdown
- **AND** selecting an entry SHALL add it to the list and `auth.bypassHosts`

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
When LLM providers are saved via the Settings panel, the server SHALL broadcast a `credentials_updated` message to all connected pi sessions. This MUST cause the model registry to refresh and push updated `models_list` messages back to the dashboard client. The Default Model selector SHALL display the updated model list without requiring a server restart.

#### Scenario: Saving new provider populates model selector
- **WHEN** the user adds a new LLM provider and clicks Save
- **THEN** the server broadcasts `credentials_updated` to all sessions
- **AND** each session's bridge refreshes its model registry
- **AND** the Default Model selector in Settings shows models from the new provider

#### Scenario: Removing a provider updates model selector
- **WHEN** the user removes an LLM provider and clicks Save
- **THEN** models from the removed provider no longer appear in the Default Model selector

#### Scenario: Models available immediately after save
- **WHEN** the user saves provider changes and opens the Default Model selector
- **THEN** models from all configured providers are listed
- **AND** no server restart is required

### Requirement: ask_user prompt timeout field in Sessions section
The Settings panel's General → Sessions section SHALL include a numeric input bound to `config.askUserPromptTimeoutSeconds`. The field SHALL accept negative integers so users can enter `-1` to disable the timeout. The control SHALL display a hint text immediately below it explaining: (a) the value is in seconds, (b) `-1` (or `0`) means “wait forever”, and (c) the default is 300 (5 minutes).

When the user changes this field, the Settings panel SHALL include `askUserPromptTimeoutSeconds` in the partial sent to `PUT /api/config`. If the user clears the field (the resulting input value is undefined / NaN), the partial SHALL fall back to the default `300` rather than silently writing `0`.

The server's `writeConfigPartial` SHALL persist the value verbatim through its existing top-level scalar merge (`{ ...existing, ...partial }`); no auth-section-style special handling is required. A subsequent `GET /api/config` SHALL return the persisted value with no redaction.

Changing this field SHALL NOT mark the save as restart-requiring — the bridge re-reads `config.askUserPromptTimeoutSeconds` on every `session_start`, so the new timeout takes effect on the next pi session reload (`/reload`) without a server restart.

#### Scenario: Field is rendered with current value
- **WHEN** the user opens `/settings` with `askUserPromptTimeoutSeconds: 600` on disk
- **THEN** the General → Sessions section SHALL show a numeric input populated with `600`
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
The Settings panel (`packages/client/src/components/SettingsPanel.tsx`) SHALL render a numeric input field for `spawnRegisterTimeoutMs` under the General → Sessions group (or nearest equivalent group containing other spawn-related fields). The field SHALL be labelled "Spawn register timeout (ms)" with helper text "How long to wait for a spawned pi session to connect before showing a warning. Default 30000 (30s). Range 5000–120000."

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

### Requirement: Per-page dirty indicators

Each page in the left navigation rail SHALL display a dirty indicator when any settings source belonging to that page has unsaved edits, and SHALL clear it when those sources are clean (saved or discarded).

#### Scenario: Dirty page shows an indicator
- **WHEN** the user edits a field on the Server page and switches to another page without saving
- **THEN** the Server page's nav entry SHALL show a dirty indicator

#### Scenario: Indicator clears after save
- **WHEN** the user saves and the Server page's sources commit successfully
- **THEN** the Server page's dirty indicator SHALL clear

### Requirement: Unsaved-changes navigation guards

When the draft is dirty, the panel SHALL guard against losing edits on exit. In-app navigation away from the Settings panel (the header Back button, route change, browser back/forward) SHALL be intercepted with a confirm dialog offering **Save changes**, **Discard**, and **Cancel (keep editing)**. Hard exits that JavaScript cannot intercept with a custom dialog (tab close, reload, Electron window close) SHALL be guarded with a `beforeunload` handler that is registered only while the draft is dirty. When the draft is clean, no guard SHALL fire.

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

