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

### Requirement: Live-view tile

The plugin SHALL claim a content-view slot with a tile per `{instanceId, tabId}` listed in `browser_relay_status` that subscribes with `browser_relay_subscribe {instanceId, tabId}`, renders `browser_relay_frame` JPEGs scaled to the tile, forwards pointer/keyboard/wheel events as `browser_relay_input` of kinds `mouse`/`key`/`scroll` only with coordinates normalized to `[0,1]` of the rendered frame, and shows the tab state from `browser_relay_status`.

#### Scenario: Tab list drives tiles

- **WHEN** `browser_relay_status` reports a new tab on a live instance
- **THEN** a tile for it SHALL appear; when the tab disappears from the status the tile SHALL unmount and unsubscribe

#### Scenario: No frames

- **WHEN** the tile receives a `"no-frames"` state for its tab
- **THEN** it SHALL overlay "No repaints — tab may be idle or in the background" with a `Bring to front` action that sends `browser_relay_input {kind: "bringToFront"}`

#### Scenario: DevTools conflict

- **WHEN** the tile receives `browser_relay_status {state: "detached", reason: "devtools"}`
- **THEN** it SHALL overlay "DevTools open on this tab — close it to resume" and stop forwarding input

#### Scenario: Tile unmounts

- **WHEN** the tile unmounts or the client disconnects
- **THEN** it SHALL send `browser_relay_unsubscribe` (or the server SHALL treat the socket close as unsubscribe)

#### Scenario: Remote viewer

- **WHEN** the dashboard is opened through the tunnel
- **THEN** the tile SHALL work over the existing `/ws` gateway and SHALL NOT attempt to reach `/ws/browser-ext/` or `/ws/browser-cdp/`
