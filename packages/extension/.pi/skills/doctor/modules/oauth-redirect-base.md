---
name: oauth-redirect-base
scope: Report which OAuth redirect base actually won, and which tier produced it.
symptoms:
  - redirect_uri_mismatch
  - oauth login loop
  - callback goes to localhost
  - login works locally but not behind the proxy
  - which redirect base is in use
  - oauth broken behind reverse proxy
depends-on:
  - install-topology
derives-from:
  - GET /api/auth/diagnostics over loopback (server-enriched)
  - ~/.pi/dashboard/config.json auth.redirectBaseUrl (live)
  - ~/.pi/dashboard/server.log "OAuth redirect base:" line (live)
---

## SCOPE
Which base the dashboard mints OAuth `redirect_uri` from, and which tier of the
precedence chain produced it. Distinct from "is the value malformed" — that is
the server's own startup warning.

## KNOWLEDGE
Precedence, highest first:
1. `auth.redirectBaseUrl` — operator-stated scalar, config file / Settings ▸ Security
2. `getTunnelUrl()` — the active tunnel
3. `http://localhost:<port>` — fallback

`publicBaseUrls` is NOT a tier. It is a LIST (every address the dashboard
answers on); an OAuth `redirect_uri` must be ONE pre-registered origin, so no
inference rule promotes it. The operator states the scalar.

Trailing slashes are stripped from whichever base wins. An empty string counts
as absent and falls through.

Two traps:
- **The provider must be told too.** Setting the config field alone still fails
  with `redirect_uri_mismatch` until the identical callback URL is registered in
  the GitHub / Google / Keycloak app settings.
- **Boot with zero resolvable providers** installs no `/auth/*` route and no
  `_reloadAuth`, so an auth config change is inert until a restart. The endpoint
  reports `authActive: false` in that state.

## CHECKS
- `GET /api/auth/diagnostics` over **loopback** (server-enriched): returns
  `{ redirectBase, source, authActive, providerCount }`. `networkGuard` admits
  loopback with no JWT — which is the point, since a remote operator with broken
  OAuth cannot obtain one.
- Server down / no HTTP: grep `~/.pi/dashboard/server.log` for
  `OAuth redirect base:` — written at every register and reload.
- Compare `source` against the deployment: behind a reverse proxy the expected
  source is `auth.redirectBaseUrl`; `tunnel` or `localhost` there means the
  override is absent or empty.

## FIX ROUTING
- `source: localhost` behind a proxy → set `auth.redirectBaseUrl` (Settings ▸
  Security, or the Gateway "add gateway URL" action with OAuth selected).
- `source: tunnel` but the browser reached a custom domain → same fix; the
  override outranks the tunnel by design.
- Base correct but login still fails → register the identical
  `<base>/auth/callback/<provider>` with the provider.
- `authActive: false` → the server booted with zero resolvable providers;
  restart after configuring one. `PUT /api/config` alone cannot help.
- Warning in the log about credentials / query / fragment → the value is used as
  written but is almost certainly wrong; strip `user:pass@`, `?…`, `#…`.

## DERIVES-FROM
Server-enriched: `GET /api/auth/diagnostics`. Live: `config.json`
`auth.redirectBaseUrl`, `server.log` resolved-base line.
Hash sidecar: `oauth-redirect-base.knowledge.hash`.
