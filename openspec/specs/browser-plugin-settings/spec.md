# browser-plugin-settings Specification

## Purpose
Gives the dashboard user a settings section to see Chrome profiles, pair them with the Playwright extension, connect/disconnect, flip the kill switch, and read the audit trail — plus a live-view tile that shows and lightly steers the tab an agent is driving.

## Requirements

### Requirement: Browser settings section

The `browser` plugin SHALL claim the `settings-section` slot with a section containing, in order: a global `Enabled` toggle bound to `PUT /api/browser/enabled`, the "Agent browsing" group, the "Dedicated agent profile" panel, the "My Chrome profiles" list and the audit list.

The "My Chrome profiles" list SHALL show every profile from `GET /api/browser/profiles` with `installed: true` (including rows synthesized for a live instance) as a row, and SHALL group every profile with `installed: false` behind one disclosure row labelled with their count, each with a link to the extension's Web Store page. A row SHALL show label, email (if any), `hasToken`, connected state (derived from `instances`, with tab count) and, when `passwordManagers` is non-empty, a warning naming them and stating that the agent disconnects on pages with a password field. A row SHALL show a token input (paste from the extension's page, stored via plugin config), a `Zero-dialog` toggle (`zeroDialog`, only enabled when `hasToken`, with help text that a mismatched token shows as a 60 s timeout), `Connect` / `Disconnect` (per instance, by `instanceId`), and an `allowedDomains` editor whose placeholder states that the global list applies when it is empty and whose help text states it guards `Page.navigate`/`Target.createTarget` only and does not stop navigation through scripts, link clicks or redirects. Rows are keyed by `profileDirectory`. Tokens SHALL be write-only in the UI (never re-displayed after save).

#### Scenario: Extension not installed

- **WHEN** a profile has `installed: false`
- **THEN** it SHALL appear only inside the "profiles without the extension" disclosure, with a link to the extension's Web Store page and no `Connect` button

#### Scenario: Token saved

- **WHEN** the user pastes a token and saves
- **THEN** the plugin config `plugins.browser.browsers.<profileDirectory>.token` SHALL be written, the input SHALL clear, `hasToken` SHALL become true, and the token SHALL not appear in any subsequent `GET`

#### Scenario: Kill switch

- **WHEN** the user turns `Enabled` off
- **THEN** every row SHALL show no instances within 2 s, `Connect` SHALL be disabled with the reason "Browser relay disabled", and the dedicated panel SHALL show the profile as stopped

#### Scenario: Capability missing

- **WHEN** `GET /api/browser/status` reports `canOpenChrome: false`
- **THEN** the "My Chrome profiles" list SHALL render a single explanatory notice and no `Connect` buttons, and the "One of my Chrome profiles" choice of the default browser SHALL be disabled; the dedicated panel and choice SHALL follow `status.dedicated` only

#### Scenario: Password manager warning

- **WHEN** a profile row reports `passwordManagers: ["LastPass"]`
- **THEN** the row SHALL show a warning naming LastPass

### Requirement: Audit viewer

The section SHALL include an audit list fed by `GET /api/browser/audit?profile=`, newest-first, showing time, kind, and detail, for each profile with entries and for the dedicated profile (`@dedicated`); it SHALL refresh when `browser_relay_status.auditSeq` changes.

#### Scenario: Denied verb appears

- **WHEN** the relay denies a CDP method for a profile
- **THEN** the audit list for that profile SHALL show a `denied` row naming the method within 2 s

#### Scenario: Extension detach appears

- **WHEN** the extension closes an instance after all controlled tabs detached
- **THEN** the audit list for that profile SHALL show a `detach` row with the cause within 2 s

### Requirement: Browser badge lists relay tabs to open in the pane

The `browser-relay-badge` on a session card SHALL be shown while at least one relay instance has at least one listed tab. It SHALL be an accessible button whose `aria-label` names the action. Activating it SHALL open a menu listing every live relay tab (title, state indicator) with an "Open in pane" action per tab, plus "Open all in pane". "Open in pane" SHALL open the tab in the editor pane of the session whose card was activated and SHALL select that session. "Open all in pane" SHALL open every listed tab in that same pane, in list order, without duplicating already-open ones, leaving the last one active. Activating the badge SHALL NOT replace the chat with any browser surface.

#### Scenario: Open one tab from the badge
- **WHEN** the user activates the badge on session `S`'s card and chooses "Open in pane" for tab 42 of `inst-1`
- **THEN** session `S` SHALL become selected and its pane SHALL show `browser:inst-1:42` as the active tab, with the chat still visible in the split

#### Scenario: Open all
- **WHEN** two relay tabs are listed, one is already open in session `S`'s pane, and the user chooses "Open all in pane" on `S`'s card
- **THEN** `S`'s pane SHALL contain exactly one tab per relay tab, with the second listed tab active

#### Scenario: Keyboard use
- **WHEN** the badge has focus and the user presses Enter, then the arrow keys and Enter
- **THEN** the menu SHALL open, its items SHALL be traversable, and Enter SHALL perform the focused item's action

### Requirement: This-computer block in the browser settings section

When the dashboard runs in an Electron main window that exposes `window.piDashboard.browserHost`, the browser settings section SHALL show a "This computer" block listing that machine's Chrome profiles with `installed`, a write-only pairing-token input per profile that calls `setToken` and never renders a stored token, and the stored operator consents with a Revoke action each. Outside Electron, or when `browserHost` is absent, the block SHALL NOT render. The block SHALL send no token to the server. Tokens set here apply only to that machine's profiles; the dashboard-host profile rows and their server-side token, `Zero-dialog` toggle, `allowedDomains` editor and `canOpenChrome:false` notice SHALL be unchanged and SHALL NOT list operator profiles.

#### Scenario: Plain browser
- **WHEN** the settings section renders in a browser without `window.piDashboard.browserHost`
- **THEN** no "This computer" block SHALL be rendered

#### Scenario: Token saved locally
- **WHEN** the user pastes a token for profile P in the block and saves
- **THEN** `setToken(P, token)` SHALL be called, the input SHALL clear, and no HTTP request or WS message SHALL carry the token

#### Scenario: Revoke a consent
- **WHEN** the user activates Revoke on a stored consent
- **THEN** `revokeConsent(key)` SHALL be called and the consent SHALL disappear from the list

### Requirement: Agent browsing settings group

The section SHALL include an "Agent browsing" group that reads and writes, through `PUT /api/browser/settings`, the settings used by `browser_connect`:
- Default browser: "Dedicated agent profile" (`defaultBrowser: "@dedicated"`, default), "One of my Chrome profiles" with a picker of installed profiles (`defaultBrowser: <profileDirectory>`, also stored as `realProfile`), or "Headless, no logins" (`"@headless"`);
- If it is unavailable: "Ask me" (`onUnavailable: "ask"`, default), "Try the next browser" (`"next"`) or "Stop the task" (`"stop"`), with help text naming the order from the default: dedicated, then the chosen Chrome profile, then headless (a headless default stays headless);
- Disconnect when idle: 5, 30 (default), 120 minutes or never (`idleDisconnectMinutes`: 5, 30, 120, 0);
- Connections per Chrome profile: one or several (`allowMultipleInstancesPerProfile`), with help text that the dedicated profile always serves one session;
- Live view: open the browser tab in the session's pane on connect (`openLiveViewOnConnect`, default on);
- Allowed domains: the global list (`allowedDomains`), with the same guardrail help text as the per-profile editor.

The dedicated choice SHALL be disabled when `status.dedicated.available` is false. While the plugin is disabled, the group SHALL be read-only with the reason "Browser relay disabled", because every `/api/browser/*` write except `PUT /api/browser/enabled` is refused then.

`PUT /api/browser/settings` SHALL reject unknown keys, out-of-range values and a `defaultBrowser` profile that is not installed with 400, leaving the stored settings unchanged.

#### Scenario: Change default browser

- **WHEN** the user picks "One of my Chrome profiles" with profile `Profile 21`
- **THEN** `plugins.browser.defaultBrowser` and `plugins.browser.realProfile` SHALL become `Profile 21`, and the next `browser_connect {}` SHALL connect `Profile 21`

#### Scenario: Invalid value

- **WHEN** a client writes `idleDisconnectMinutes: -5`
- **THEN** the route SHALL answer 400 and the stored value SHALL be unchanged

### Requirement: Dedicated agent profile panel

The section SHALL include a panel for the dedicated profile, driven only by `status.dedicated`, showing its state (`not-created`, `stopped`, `starting`, `running`; when running with a client, the holder: a session's display name resolved from its `sessionId`, or a REST `client` label as given), last used time, size on disk, the data directory path, and the fact that it serves one session at a time. Its copy SHALL state that sign-ins persist, that open tabs close when the dashboard restarts, that tabs the user opens by hand in that window are visible to the agent, and that the profile is not protected from other programs running as the same user. It SHALL offer:
- in state `not-created`, "Create and open to sign in"; otherwise "Open to sign in" (both `POST /api/browser/dedicated/open`);
- "Stop" (`POST /api/browser/dedicated/stop`) while running;
- "Reset profile…" (`POST /api/browser/dedicated/reset`), enabled only while stopped, behind a confirmation that states cookies, logins and history are deleted.

When `status.dedicated.available` is false, the panel SHALL show the reason and no actions. When the plugin is disabled, the panel SHALL show the profile as stopped and disable every action.

#### Scenario: Not available on this host

- **WHEN** `status.dedicated` reports `available: false, reason: "no-chrome"`
- **THEN** the panel SHALL state that desktop Google Chrome is needed and show no buttons

#### Scenario: First use

- **WHEN** `status.dedicated.state` is `not-created`
- **THEN** the panel SHALL offer "Create and open to sign in" and no Reset

#### Scenario: Reset needs confirmation

- **WHEN** the user presses "Reset profile…" while the profile is stopped
- **THEN** a confirmation SHALL appear and no request SHALL be sent until the user confirms
