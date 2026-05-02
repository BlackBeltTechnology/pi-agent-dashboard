## ADDED Requirements

### Requirement: Settings button in sidebar header
The sidebar header SHALL include a gear icon button positioned at the end of the header row (after the collapse button). Clicking the button SHALL navigate to `/settings`.

#### Scenario: Settings button visible
- **WHEN** the sidebar is rendered
- **THEN** a gear icon button SHALL be visible in the header row after the collapse button

#### Scenario: Settings button click
- **WHEN** the user clicks the gear icon button
- **THEN** the app SHALL navigate to `/settings` and the main content area SHALL show the settings panel

### Requirement: Settings panel view
The settings panel SHALL render as a full-page view in the main content area when the route is `/settings`. It SHALL display a fixed header (back button, title, Restart and Save buttons), a tab bar, and a scrollable content area for the active tab. The header and tab bar SHALL remain visible at all times regardless of scroll position.

The panel SHALL provide 4 tabs:
- **General**: Server (`port`, `piPort`, `autoShutdown`, `shutdownIdleSeconds`), Sessions (`spawnStrategy`, `reattachPlacement`, `askUserPromptTimeoutSeconds`, `defaultModel`), Tunnel (`tunnel.enabled`), Developer (`devBuildOnReload`)
- **Providers**: Provider Authentication (ProviderAuthSection) and LLM Providers (custom OpenAI-compatible endpoints)
- **Security**: OAuth dashboard access (`auth.providers` per-provider config, `auth.allowedUsers`, `auth.bypassUrls`), and **Trusted Networks** (the combined trusted-host/network bypass control that writes to `auth.bypassHosts`)
- **Advanced**: Memory Limits (`memoryLimits.maxEventsPerSession`, `memoryLimits.maxStringFieldSize`, `memoryLimits.maxWsBufferBytes`)

#### Scenario: Settings panel layout with tabs
- **WHEN** the user navigates to `/settings`
- **THEN** the panel SHALL display a fixed header with back button, "Settings" title, Restart button, and Save button
- **AND** below the header, a tab bar with 4 tabs: General, Providers, Security, Advanced
- **AND** below the tab bar, the active tab's content in a scrollable area
- **AND** the General tab SHALL be selected by default

#### Scenario: Fixed header stays visible on scroll
- **WHEN** the active tab's content is long enough to scroll
- **THEN** the header and tab bar SHALL remain fixed at the top
- **AND** only the tab content area SHALL scroll

#### Scenario: Tab switching
- **WHEN** the user clicks a different tab
- **THEN** the content area SHALL display that tab's settings sections
- **AND** the clicked tab SHALL show an active indicator (accent underline)
- **AND** the previously active tab SHALL lose its active indicator

#### Scenario: General tab content
- **WHEN** the General tab is active
- **THEN** the content SHALL display Server, Sessions, Tunnel, and Developer sections with their respective fields
- **AND** the content SHALL NOT contain any Trusted Networks or auth-bypass controls

#### Scenario: Providers tab content
- **WHEN** the Providers tab is active
- **THEN** the content SHALL display the Provider Authentication section (ProviderAuthSection component) and the LLM Providers section (custom endpoint cards with add/remove)

#### Scenario: Security tab content
- **WHEN** the Security tab is active
- **THEN** the content SHALL display OAuth provider configuration (GitHub, Google, Keycloak, OIDC), Allowed Users textarea, Bypass URLs textarea, and a Trusted Networks section with per-entry rows, a "+ Add Local Network" auto-detect dropdown, a manual-entry input accepting exact IP / wildcard / CIDR, and an explicit security warning
- **AND** the content SHALL NOT contain a standalone "Trusted Hosts" textarea (replaced by the Trusted Networks section)

#### Scenario: Advanced tab content
- **WHEN** the Advanced tab is active
- **THEN** the content SHALL display Memory Limits fields (max events per session, max string truncation, max WebSocket buffer)

#### Scenario: Save applies across all tabs
- **WHEN** the user modifies fields on multiple tabs and clicks Save
- **THEN** the panel SHALL send all changed fields (from any tab) in a single save operation

#### Scenario: Settings panel back navigation
- **WHEN** the user clicks the back button in the header
- **THEN** the app SHALL navigate away from `/settings` to the previous view

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
