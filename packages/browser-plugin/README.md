# @blackbelt-technology/pi-dashboard-browser-plugin

Dashboard plugin that relays CDP from the user's real, logged-in Chrome (via the
[Playwright Chrome Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm))
to pi sessions — SSO/cookie state reachable by `agent-browser connect <cdpUrl>`
with zero new agent tools.

- **Settings section** (`settings-section` → `BrowserSettings`) — profile list
  (installed / token / connected), per-profile pairing-token paste (write-only),
  `Zero-dialog` toggle, `allowedDomains` guardrail editor, Connect/Disconnect,
  global kill switch, audit viewer.
- **Live-view tile** (`content-view` → `LiveViewTile`, predicate-gated) —
  screencast frames from the relay, allowlisted pointer/key/scroll input,
  no-frames detector, DevTools-conflict notice.

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

See change: `add-browser-relay`.
