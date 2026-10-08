# @blackbelt-technology/pi-dashboard-browser-plugin

Dashboard plugin that relays CDP from the user's real, logged-in Chrome (via the
[Playwright Chrome Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm))
to pi sessions — SSO/cookie state reachable by `agent-browser connect <cdpUrl>`,
shown live in the dashboard editor pane.

- **Settings section** (`settings-section` → `BrowserSettings`) — profile list
  (installed / token / connected), per-profile pairing-token paste (write-only),
  `Zero-dialog` toggle, `allowedDomains` guardrail editor, Connect/Disconnect,
  global kill switch, audit viewer.
- **Browser pane tab** (`editor-pane-tab`, prefix `browser`, → `BrowserPaneTab` +
  `BrowserTabLabel`) — each relay tab opens as the editor-pane tab
  `browser:<instanceId>:<tabId>` next to the chat (it never replaces it):
  screencast frames, Fit/1:1, a read-only URL, Input on/off, Bring to front,
  allowlisted pointer/touch/wheel/key input (a tap is a click), a text bridge
  for phone soft keyboards, remote viewport that follows the pane (unless the
  agent owns emulation), DevTools-conflict and idle notices, and **Done ✓**
  while the agent waits for a login takeover.
- **Badge menu** (`session-card-badge` → `BrowserRelayBadge`) — lists every live
  relay tab: "Open in pane" / "Open all in pane" into that card's session.
- **Agent tools** (bridge entry `src/bridge/index.ts`) — `browser_show_in_pane`
  (open a tab in the calling session's pane, 5 s rate limit) and
  `browser_await_human` (open it, then block on a confirm the pane's Done
  answers; `done` / `cancelled`). The session id comes from the connection,
  never the arguments.

## Prerequisites

- Chrome **and the Playwright Chrome Extension**, installed in the profile you
  will drive, on the **same host as the dashboard server** (the CDP URL is
  loopback; the pane tab works from any browser/phone that can reach the
  dashboard over `/ws`).
- Enable the plugin (it is off by default) in Settings → Browser Relay.

## Relay behavior worth knowing

- Nothing viewer-facing carries the extension's connect page, pairing token or
  relay guid: it is omitted from tab lists and refused for subscribe/input;
  `chrome-extension:` URLs are stripped of query/fragment.
- Standard CDP clients (`agent-browser connect`, Playwright `connectOverCDP`)
  attach: session-less discovery verbs are answered locally and
  `Browser.setDownloadBehavior` is acknowledged and dropped (audit `dropped`).
- Tab titles/URLs follow navigation (refreshed through the extension).

Disabled by default (`defaultEnabled: false` in the manifest — enabling is a
settings toggle; the design calls for opt-in before an agent can drive the
operator's SSO Chrome).

Server side vendors playwright-core's CDP relay under
`src/server/relay/vendor/` (Apache-2.0, upstream SHA + per-file hashes in
`vendor/NOTICE`; verbatim — refresh is a re-copy, never an edit). Transport and
browser launch are supplied by the plugin's own `relay-instance` /
`ctx.registerWsRoute` path, not the vendored HTTP listener.

Config lives under `plugins.browser.*` in `~/.pi/dashboard/config.json`
(`configSchema.json`): `enabled`, `defaultBrowser`,
`allowMultipleInstancesPerProfile`, and per-profile
`browsers.<profileDirectory>.{ token (writeOnly), zeroDialog, allowedDomains }`.

See changes: `add-browser-relay`, `add-browser-editor-pane-tab`.
