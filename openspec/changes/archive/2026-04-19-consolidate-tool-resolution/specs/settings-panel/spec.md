## MODIFIED Requirements

### Requirement: Settings panel view
The settings panel SHALL render as a full-page view in the main content area when the route is `/settings`. It SHALL display a fixed header (back button, title, Restart and Save buttons), a tab bar, and a scrollable content area for the active tab. The header and tab bar SHALL remain visible at all times regardless of scroll position.

The panel SHALL provide 4 tabs:
- **General**: Server (`port`, `piPort`, `autoShutdown`, `shutdownIdleSeconds`), Sessions (`spawnStrategy`), Tunnel (`tunnel.enabled`), Developer (`devBuildOnReload`), **Tools** (tool-registry status, overrides, rescan — see `tool-settings-ui` capability)
- **Providers**: Provider Authentication (ProviderAuthSection) and LLM Providers (custom OpenAI-compatible endpoints)
- **Security**: OAuth dashboard access (`auth.providers` per-provider config, `auth.allowedUsers`, `auth.bypassUrls`, `auth.bypassHosts`)
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
- **THEN** the content SHALL display Server, Sessions, Tunnel, Developer, and Tools sections with their respective fields
- **AND** the Tools section SHALL render per the `tool-settings-ui` capability (one row per registered tool + Rescan all / Reset overrides / Export diagnostics buttons)

#### Scenario: Providers tab content
- **WHEN** the Providers tab is active
- **THEN** the content SHALL display the Provider Authentication section (ProviderAuthSection component) and the LLM Providers section (custom endpoint cards with add/remove)

#### Scenario: Security tab content
- **WHEN** the Security tab is active
- **THEN** the content SHALL display OAuth provider configuration (GitHub, Google, Keycloak, OIDC), Allowed Users textarea, Bypass URLs textarea, and Trusted Hosts textarea

#### Scenario: Advanced tab content
- **WHEN** the Advanced tab is active
- **THEN** the content SHALL display Memory Limits fields (max events per session, max string truncation, max WebSocket buffer)

#### Scenario: Save applies across all tabs
- **WHEN** the user modifies fields on multiple tabs and clicks Save
- **THEN** the panel SHALL send all changed fields (from any tab) in a single save operation
- **AND** Tools section mutations (override set/clear, rescan) SHALL be applied immediately via their own `/api/tools*` endpoints and SHALL NOT participate in the config Save batch

#### Scenario: Settings panel back navigation
- **WHEN** the user clicks the back button in the header
- **THEN** the app SHALL navigate away from `/settings` to the previous view
