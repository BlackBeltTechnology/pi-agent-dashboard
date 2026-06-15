# settings-panel (delta)

## MODIFIED Requirements

### Requirement: Settings panel view
The settings panel SHALL render as a full-page view in the main content area when the route matches `/settings/:page?`. It SHALL display a fixed header (back button, title, Restart and Save buttons), a **left navigation rail** listing pages grouped by concern, and a content area for the active page. The header SHALL remain visible at all times regardless of scroll position. A single `SettingsPanel` instance SHALL remain mounted across page changes so unsaved edits on any page persist until Save.

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
- **THEN** the panel SHALL display a fixed header (back, "Settings" title, Restart, Save)
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
- **WHEN** the user modifies fields on multiple pages and clicks Save
- **THEN** the panel SHALL send all changed fields (from any page) in a single save operation
- **AND** navigating between pages before Save SHALL NOT discard unsaved edits

#### Scenario: Settings panel back navigation
- **WHEN** the user clicks the back button in the header
- **THEN** the app SHALL navigate away from settings to the previous view

## ADDED Requirements

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
`VALID_SETTINGS_TABS` (and the `SettingsTab` type) SHALL enumerate the full set of page ids: `general, server, sessions, remote, security, providers, packages, plugins, openspec, developer`. The plugin `settings-section` slot SHALL continue to target a page via its `tab` field, defaulting to `general` when unset. Each settings page SHALL mount `<SettingsSectionSlot tab={page} />` so plugin claims render on their targeted page. Claims targeting an id outside the enumerated set SHALL be treated as `general`.

#### Scenario: Unset claim lands on General
- **WHEN** a plugin registers a `settings-section` claim with no `tab`
- **THEN** the claim SHALL render on the General page

#### Scenario: Claim targets a new page id
- **WHEN** a plugin registers a `settings-section` claim with `tab: "developer"`
- **THEN** the claim SHALL render on the Developer page

#### Scenario: Third-party claim with unknown id falls back
- **WHEN** a plugin registers a `settings-section` claim with an id not in `VALID_SETTINGS_TABS`
- **THEN** the claim SHALL render on the General page
