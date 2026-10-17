# browser-plugin-settings Specification

## Purpose
Gives the dashboard user a settings section to see Chrome profiles, pair them with the Playwright extension, connect/disconnect, flip the kill switch, and read the audit trail — plus a live-view tile that shows and lightly steers the tab an agent is driving.

## Requirements

### Requirement: Browser settings section

The `browser` plugin SHALL claim the `settings-section` slot with a section listing every profile from `GET /api/browser/profiles` as a row showing label, email (if any), `installed`, `hasToken`, connected state (derived from `instances`, with tab count), a token input (paste from the extension's page, stored via plugin config), a `Zero-dialog` toggle (`zeroDialog`, only enabled when `hasToken`, with help text that a mismatched token shows as a 60 s timeout), `Connect` / `Disconnect` (per instance, by `instanceId`), an `allowedDomains` editor with help text stating it guards `Page.navigate`/`Target.createTarget` only, and a global `Enabled` toggle bound to `PUT /api/browser/enabled`. Rows are keyed by `profileDirectory`. Tokens SHALL be write-only in the UI (never re-displayed after save).

#### Scenario: Extension not installed

- **WHEN** a row has `installed: false`
- **THEN** `Connect` SHALL be disabled and the row SHALL show a link to the extension's Web Store page

#### Scenario: Token saved

- **WHEN** the user pastes a token and saves
- **THEN** the plugin config `plugins.browser.browsers.<profileDirectory>.token` SHALL be written, the input SHALL clear, `hasToken` SHALL become true, and the token SHALL not appear in any subsequent `GET`

#### Scenario: Kill switch

- **WHEN** the user turns `Enabled` off
- **THEN** every row SHALL show no instances within 2 s and `Connect` SHALL be disabled with the reason "Browser relay disabled"

#### Scenario: Capability missing

- **WHEN** `GET /api/browser/status` reports `canOpenChrome: false`
- **THEN** the section SHALL render a single explanatory notice and no `Connect` buttons

### Requirement: Audit viewer

The section SHALL include a per-profile audit list fed by `GET /api/browser/audit?profile=`, newest-first, showing time, kind, and detail; it SHALL refresh when `browser_relay_status.auditSeq` changes.

#### Scenario: Denied verb appears

- **WHEN** the relay denies a CDP method for a profile
- **THEN** the audit list for that profile SHALL show a `denied` row naming the method within 2 s

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
