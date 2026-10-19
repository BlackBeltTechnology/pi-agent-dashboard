# browser-plugin-settings Specification

## Purpose
Gives the dashboard user a settings section to see Chrome profiles, pair them with the Playwright extension, connect/disconnect, flip the kill switch, and read the audit trail — plus a live-view tile that shows and lightly steers the tab an agent is driving.

## Requirements

### Requirement: Browser settings section

The `browser` plugin SHALL claim the `settings-section` slot with a section listing every profile from `GET /api/browser/profiles`. The section SHALL NOT render a heading repeating the plugin's display name or id. It SHALL open with a one-line intro and a switch labelled "Relay connections" (never "Enabled") bound to `PUT /api/browser/enabled`, whose hint states that turning it off blocks every Chrome profile while the plugin stays on; the existing `browser-enabled-toggle` testid SHALL be kept.

Each profile SHALL render as a collapsible card keyed by `profileDirectory`, titled with the profile label and showing the email (if any) as subtitle. The card summary SHALL show status as word pills that stay visible while the card is collapsed: "Extension installed" / "Extension missing", "Paired" / "Not paired" (from `hasToken`), and "Connected · N tabs" while an instance is connected (derived from `instances`). Status SHALL never be conveyed by colour alone. The card body SHALL contain:

- a labelled "Pairing token" password field (paste from the extension's page, stored via plugin config) with a "Save token" button; its hint says a token is saved and a new one replaces it when `hasToken`;
- a "Skip Chrome's Allow prompt" switch (`zeroDialog`), enabled only when `hasToken`; when disabled its hint SHALL say "Pair this profile first", otherwise it SHALL state that a mismatched token, Reject, or no answer all appear as a 60 s timeout;
- an "Allowed domains" field (comma-separated `allowedDomains`) whose hint states it limits page navigation/opening (`Page.navigate`/`Target.createTarget`) only and does not filter other network traffic;
- `Connect` / `Disconnect` (per instance, by `instanceId`) as secondary buttons, or a link to the extension's Web Store page when the extension is not installed;
- the collapsed "Activity" group (see Audit viewer).

Profiles with `installed: true` SHALL be listed under a "Chrome profiles with the extension" section heading. Profiles with `installed: false` SHALL be grouped in one "Other Chrome profiles" group, collapsed by default, whose summary states how many profiles it holds and that their extension is missing.

Profile actions (token save, `zeroDialog`, `allowedDomains`, Connect, Disconnect) SHALL keep writing immediately through the plugin's own REST routes, not through the host Save bar. While an action is in flight the card's controls SHALL be disabled. A failed profile action SHALL show an error notice inside that profile's card — one sentence naming what failed, with a "Try again" action — and SHALL NOT blank the rest of the page. Tokens SHALL be write-only in the UI (never re-displayed after save); after a failed token save the typed token SHALL stay in the input so "Try again" can resend it, and SHALL NOT appear in the error notice or in "Copy details". `allowedDomains` SHALL be written on blur, as today. All existing `browser-*` data-testids and `plugins.browser.*` config keys SHALL be preserved.

#### Scenario: Extension not installed

- **WHEN** a row has `installed: false`
- **THEN** `Connect` SHALL be disabled and the row SHALL show a link to the extension's Web Store page
- **AND** the profile card SHALL be inside the collapsed "Other Chrome profiles" group with an "Extension missing" pill

#### Scenario: Token saved

- **WHEN** the user pastes a token and saves
- **THEN** the plugin config `plugins.browser.browsers.<profileDirectory>.token` SHALL be written, the input SHALL clear, `hasToken` SHALL become true, and the token SHALL not appear in any subsequent `GET`
- **AND** the card summary SHALL show the "Paired" pill

#### Scenario: Kill switch

- **WHEN** the user turns "Relay connections" off
- **THEN** every row SHALL show no instances within 2 s and `Connect` SHALL be disabled with the reason "Browser relay disabled"
- **AND** an info notice SHALL state that relay connections are off and no session can reach Chrome until they are turned back on

#### Scenario: Capability missing

- **WHEN** `GET /api/browser/status` reports `canOpenChrome: false`
- **THEN** the section SHALL render a single explanatory notice and no `Connect` buttons

#### Scenario: In-body switch is not named Enabled

- **WHEN** the section renders
- **THEN** the relay kill switch SHALL have the visible label and accessible name "Relay connections"
- **AND** no control in the body SHALL be labelled "Enabled", "Enable" or "On"
- **AND** no heading in the body SHALL equal "Browser Relay" or `browser`

#### Scenario: Collapsed card still shows status

- **WHEN** a profile card is collapsed
- **THEN** its summary SHALL still show its extension, pairing and connection pills as words

#### Scenario: Profile write fails

- **WHEN** saving a token for a profile fails because the dashboard server did not answer
- **THEN** that profile's card SHALL show an error notice such as "The token was not saved. The dashboard server did not answer." with a "Try again" action
- **AND** the other profiles and the "Relay connections" switch SHALL remain rendered and usable

#### Scenario: Relay switch write fails

- **WHEN** the `PUT /api/browser/enabled` write fails
- **THEN** the switch SHALL return to its previous state and an error notice with "Try again" SHALL be shown
- **AND** the profile list SHALL stay rendered

#### Scenario: Initial load fails

- **WHEN** the profiles or status request fails on first load
- **THEN** the section SHALL show an error notice (`browser-settings-error`) stating that Browser Relay settings are unavailable, with a "Try again" action
- **AND** any raw error detail SHALL be available only behind a "Copy details" action

#### Scenario: Password manager warning

- **WHEN** a profile row reports `passwordManagers: ["LastPass"]`
- **THEN** the row SHALL show a warning naming LastPass

### Requirement: Audit viewer

Each profile card SHALL include an "Activity" group, collapsed by default, fed by `GET /api/browser/audit?profile=`, newest-first, showing time, event, and detail as a read-only table. The event column SHALL show a human event word (for example "Connected", "Token saved", "Denied"), never the raw audit `kind` token. The group summary SHALL state the entry count, or "none yet" when empty, and an empty group SHALL read "No activity yet." The list SHALL refresh when `browser_relay_status.auditSeq` changes. The existing `browser-audit-*` data-testids SHALL be preserved.

#### Scenario: Denied verb appears

- **WHEN** the relay denies a CDP method for a profile
- **THEN** the audit list for that profile SHALL show a `denied` row naming the method within 2 s
- **AND** the row's event column SHALL show a human word rather than the raw `kind` token

#### Scenario: Activity collapsed by default

- **WHEN** a profile card is expanded for the first time
- **THEN** its "Activity" group SHALL be collapsed and its summary SHALL show the entry count

#### Scenario: Extension detach appears

- **WHEN** the extension closes an instance after all controlled tabs detached
- **THEN** the audit list for that profile SHALL show a "Disconnected" row (raw kind `detach` kept as the pill's `data-status`) with the cause within 2 s

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

When the dashboard runs in an Electron main window that exposes `window.piDashboard.browserHost`, the browser settings section SHALL show, after the profile groups, a "This computer" block listing that machine's Chrome profiles with `installed`, a write-only pairing-token input per profile that calls `setToken` and never renders a stored token, and the stored operator consents with a Revoke action each. Revoke SHALL be styled as a danger action. Each host token input SHALL have a visible label; a failed `setToken` SHALL show an error sentence on that profile's row. Outside Electron, or when `browserHost` is absent, the block SHALL NOT render. The block SHALL send no token to the server. Tokens set here apply only to that machine's profiles; the dashboard-host profile rows and their server-side token, `Zero-dialog` toggle, `allowedDomains` editor and `canOpenChrome:false` notice SHALL be unchanged and SHALL NOT list operator profiles.

#### Scenario: Plain browser
- **WHEN** the settings section renders in a browser without `window.piDashboard.browserHost`
- **THEN** no "This computer" block SHALL be rendered

#### Scenario: Token saved locally
- **WHEN** the user pastes a token for profile P in the block and saves
- **THEN** `setToken(P, token)` SHALL be called, the input SHALL clear, and no HTTP request or WS message SHALL carry the token

#### Scenario: Revoke a consent
- **WHEN** the user activates Revoke on a stored consent
- **THEN** `revokeConsent(key)` SHALL be called and the consent SHALL disappear from the list

#### Scenario: Revoke reads as destructive
- **WHEN** the consents list renders
- **THEN** each Revoke action SHALL use the danger button style

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
