## Why

A loopback dev server (Vite, Next, the mockup-loop mock site on :5299) renders a blank page in the
editor-pane live viewer. Observed with the mock site (browser console, 2026-11-23):

- Root-absolute module URLs (`/@vite/client`, `/@react-refresh`, `/@fs/.../main.tsx`) leave the
  capability prefix `/live/<id>/~c/<token>/` and hit the dashboard origin `:8000` directly.
- The framed document is opaque (`sandbox` without `allow-same-origin`, origin `null`). Module
  scripts are CORS requests; Vite 6.4.3 `defaultAllowedOrigins` only matches `*localhost` /
  `127.0.0.1` / `[::1]`, so `Origin: null` is refused even for a correctly prefixed URL.
- Apps that use `localStorage` / `sessionStorage` / origin-checked `postMessage` (the mock site does:
  `packages/mockup-loop/site/Site.tsx`) throw `SecurityError` in an opaque origin.
- The escaped root-absolute requests are answered by the dashboard with its own page, and the
  capability CSP only allows scripts inside the prefix, so nothing runs (diagnosed in the earlier
  "Mockup server does not work" session, 2026-11-23, viewing the mock site in the canvas from a
  remote machine). Same blank frame locally; Open ↗ only works because it bypasses the proxy.

That session already chose "a separate address per preview" and deferred it to a proposal; this is
that proposal. Interim workarounds it found: `serve_mock_site{lan:true}` (view-only,
`http://<host>:5299`) or `ssh -L 5299:127.0.0.1:5299 <host>`.

The shipped design forbids per-host isolation ("Isolation by a distinct port or hostname SHALL NOT be
used, because the remote tunnel exposes a single port/host") and treats root-absolute pages as
hint-only (`improve-canvas-html-and-url-ux`). That keeps every dev server unusable in the pane, which
is the main reason the pane exists (`/view http://localhost:5173`, `canvas()` → server targets).

## What Changes

- **Request-dependent preview origin.** The mint picks the preview origin from the `Host` the
  minting client used to reach the dashboard. First matching tier wins; the capability is bound to
  that origin (a link minted locally does not open remotely, and vice versa):
  1. **Loopback host** → `http://<capId>.localhost:<port>/` (`*.localhost` resolves to loopback in
     Chromium, Firefox, Safari, Electron). No configuration.
  2. **Configured wildcard domain** → `https://<capId>.<previewDomain>/` when the dashboard host
     matches an operator-configured pattern (e.g. `*.preview.example.com`). Operator provides
     wildcard DNS, wildcard TLS and a reverse proxy that forwards `Host`.
  3. **LAN IP, port pool** (opt-in) → `http://<ip>:<poolPort>/`: one listener per live capability from
     a configured range (e.g. `8100-8199`). Works offline; firewall / Docker must expose the range.
  4. **LAN IP, wildcard-IP DNS** (opt-in) → `http://<capId>.<ip-dashed>.<ipDnsSuffix>:<port>/`
     (e.g. `sslip.io`). Needs public DNS; some routers block private-IP answers (DNS-rebind protection).
  5. **Base-path fallback** (single-host tunnels: zrok, Tailscale, unmatched hosts) →
     `/preview/<id>/` on the dashboard origin: a STABLE per-target path the upstream is started with
     (`base` / `basePath`), so root-absolute URLs and HMR stay inside it. Opaque origin remains;
     storage and origin-checked `postMessage` are unavailable. Servers without a base path keep the
     root-absolute hint.
- **Sandbox per tier.** Tiers 1, 2 and 4 (distinct host) MAY add `allow-same-origin`: the document gets
  its own origin, never the dashboard's. Tier 3 adds it only when every dashboard cookie is
  `HttpOnly` (cookies are not port-scoped). Tier 5 and today's path prefix keep the
  no-`allow-same-origin` rule.
- **Routing + admission.** `Host` (tiers 1, 2, 4), listener port (tier 3) or path (tier 5) selects
  the capability; the host-admission gate admits only origins of live, unexpired capabilities;
  unknown subdomains / ports get the existing 403. Pool listeners close when their capability expires.
- **Auth off the path for tier 5.** The stable `/preview/<id>/` path carries no token. Design decides
  the credential (candidates: frame-bound short-lived ticket exchanged for a preview-scoped cookie,
  `SameSite=None; Secure` where HTTPS; plain-HTTP limits documented).
- **CORS for previews only.** Tier-5 preview responses get the CORS header the opaque document needs
  (`Access-Control-Allow-Origin: null`, no credentials); dashboard `/api/*` and WS keep refusing
  `null` and every preview origin.
- **Same-site caveat handled.** Preview origins are same-site with the dashboard (ports ignored;
  `*.localhost` same site as `localhost`), so `SameSite` alone does not block requests from a preview.
  `cross-site-request-gate` (Origin check) stays the boundary on every dashboard API / WS; cookies
  are host-only (never `Domain=`), `__Host-` prefixed under HTTPS.
- **Credential isolation kept.** `stripDashboardCredentials`, `buildLiveCsp`, the egress policy,
  idle/max expiry, touch and re-mint apply unchanged per tier.
- **Reserve a tier-5 path before the server starts.** An authenticated reserve call (REST + bridge)
  returns the stable `/preview/<pid>/` for a loopback port; the viewer shows the base with a copy
  button and "restart your server with this base".
- **Mock site supports base-path mode.** `serve_mock_site` / `npm run mocks` accept `base` and start
  Vite with it; when the dashboard is reached through a tier-5 host, `serve_mock_site` reserves the
  path itself.
- **Duplicated dashboard cookies refused.** A request whose `Cookie` header carries any `pi_dash_*`
  name more than once is refused (blocks cookie shadowing / fixation from a preview sharing the
  cookie jar: tier 3 ports, tier 2 `Domain=` parent cookies). Tier 2 also warns at startup when the
  preview domain shares the dashboard's parent domain.
- **Open ↗** opens the same origin the frame uses.
- Mockup: none (the file-link pill mock moved to `render-file-links-as-pill`). Acceptance fixture: the mock site at
  `localhost:5299` renders in the pane locally (tier 1) and through a single-host tunnel (tier 5).

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `live-server-preview`: "Embedded content SHALL be origin-isolated via sandbox" (tiered origins,
  sandbox token sets per tier), "Previews authenticate through a per-preview capability path"
  (origin-bound capability, tier-5 stable path), "Browser-originated live requests require a
  capability", "CORS SHALL reject the opaque `null` origin" (dashboard routes only; tier-5 preview
  responses excepted), "Root-absolute pages explain how to view them" (hint only when no tier
  applies), "Open in browser uses the real local address for local operators"; preview-origin config
  (wildcard domain, port pool, IP-DNS suffix).
- `host-admission`: admit preview hosts / pool ports only for a live capability; refuse others.
- `cross-site-request-gate`: preview origins are never trusted origins for dashboard APIs / WS;
  duplicated `pi_dash_*` cookies are refused.
- `server-cors`: the `null`-origin refusal is scoped to dashboard routes (tier-5 preview responses excepted).
- `trusted-networks`: the network-guard jurisdiction gains `/preview/*` (tier-5 capability paths).
- `baseline-content-security-policy`: `frame-src` admits preview origins (`http://*.localhost:*`,
  configured IP-DNS suffix, live pool origins).
- `mockup-live-component-site`: `serve_mock_site` takes `base` and reserves a tier-5 path automatically.
- `mockup-site-environment`: the site runs under a supplied base path (HTML entry, `/__mock/*`,
  dev-path fixtures passthrough).

## Impact

- Server: `packages/server/src/live-server/live-server-proxy.ts` (host / port / path dispatch, HMR WS
  upgrade per tier), capability mint/registry (`routes/live-server-routes.ts`), pool listeners
  lifecycle, `auth/host-gate.ts` + shared `host-admission.ts`, `auth/cors-origin.ts`, cookie
  attributes (host-only, `HttpOnly`, `__Host-`), CSP-report reserved paths (`/__pi/*`) per tier,
  dashboard config schema (preview domain, port range, IP-DNS suffix).
- Client: `editor-pane/live/LiveFrame.tsx` (`sandboxFor` per tier), `useLiveCapability.ts` /
  `live-server-api.ts` (mint returns an origin URL + tier), `useOpenExternal.ts`, root-absolute hint gating.
- Mockup-loop: mock-site launcher / options (`base`), `serve_mock_site` tool. Builds on the
  separate `//`-path crash fix in `src/mock-site/plugin.mjs` (+ test in
  `__tests__/mock-site-server.test.ts`), landed on its own as commit 32f103c73.
  Known: `mock-site-serve.test.ts` startup ~35 s exceeds its 30 s timeout on this machine; tier-5
  mock-site E2E must budget for it.
- Electron: verify `*.localhost` resolution in the embedded window.
- Docker: tier 3 needs the pool range mapped; `docker/` compose + docs.
- Compatibility: existing `/live/<id>/~c/<token>/` URLs keep working; an old client keeps minting
  path-prefix capabilities. Rollback = disable tiers via config; viewers fall back to path prefix.
- Docs: `docs/architecture.md` "Live Preview" section, remote-access / tunnel guide (DocScribe).

## Discipline Skills

- `security-hardening` — new origins and listeners on the dashboard, sandbox relaxation
  (`allow-same-origin` on foreign origins), Host-header routing, cookie scoping, null-origin CORS
  on preview responses, tier-5 credential design.
- `doubt-driven-review` — reverses a deliberate shipped requirement (no host isolation) before it stands.
- `observability-instrumentation` — log tier choice and preview-origin admit/refuse (redacted capId)
  next to the existing `redactCapability` lines.
