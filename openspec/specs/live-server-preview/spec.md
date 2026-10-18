# live-server-preview Specification

## Purpose
TBD - created by archiving change improve-content-editor. Update Purpose after archive.

## Requirements

### Requirement: Live-server viewer embeds a running local server

The dashboard SHALL provide a `live-server-preview` viewer that embeds a **running local
HTTP server** (e.g. a Vite/dev server or served mockup) inside a session tab, so users
can preview it without leaving the dashboard. The viewer SHALL load the target through a
**server-side reverse proxy** (mirroring the `editor-view` code-server proxy idiom), not
by pointing an iframe directly at the target URL.

#### Scenario: Preview a running dev server
- **GIVEN** a dev server running at `http://127.0.0.1:5173`
- **AND** that target is on the confirmed allowlist
- **WHEN** the user opens it in a live-server tab
- **THEN** the dashboard iframes the reverse-proxied path for that target
- **AND** the running app renders inside the tab

### Requirement: Targets SHALL be loopback-only and allowlisted (SSRF guard)

The server SHALL accept live-server targets **only** for loopback hosts
(`127.0.0.1`, `::1`, `localhost`) and **only** for ports the user has explicitly
confirmed/added to a persisted allowlist. Any non-loopback host, cloud-metadata address,
or unconfirmed free-form target SHALL be rejected. Targets SHALL never be fetched
automatically from tree contents or agent-supplied input.

#### Scenario: Loopback target accepted
- **WHEN** the client requests a proxy for `127.0.0.1:5173` present in the allowlist
- **THEN** the server returns a proxied path

#### Scenario: Remote host rejected
- **WHEN** the client requests a proxy for a non-loopback host (e.g. `10.0.0.5:80` or `169.254.169.254`)
- **THEN** the server rejects the request and creates no proxy

#### Scenario: Unconfirmed port rejected
- **WHEN** the client requests a proxy for a loopback port not on the allowlist
- **THEN** the server rejects the request until the user confirms/adds the target

### Requirement: Embedded content SHALL be origin-isolated via sandbox

Proxied live-server content SHALL be reverse-proxied on the dashboard's main origin at a
path (e.g. `/live/<id>/`, mirroring `/editor/<id>/`) so it is reachable both locally and
over the single-port remote tunnel. The viewer SHALL embed it with exactly
`sandbox="allow-scripts allow-forms allow-popups allow-downloads"` and SHALL NOT set
`allow-same-origin`, so the browser assigns the framed document a unique opaque origin.
The `allow-scripts` and `allow-same-origin` tokens SHALL NOT both be present. The sandbox
SHALL NOT include `allow-downloads-without-user-activation`. Note that the browser sandbox
does not restrict downloads to user gestures: with `allow-downloads` present, an embedded
app can also trigger a download without a user gesture. Consequently the embedded app SHALL NOT be able
to read the dashboard's `localStorage`/auth token or make same-origin credentialed calls
to the dashboard APIs. Isolation by a distinct port or hostname SHALL NOT be used, because
the remote tunnel exposes a single port/host.

#### Scenario: Embedded app cannot access the dashboard origin
- **GIVEN** a malicious page served by the previewed dev server that reads
  `window.localStorage` and calls `/api/restart`
- **WHEN** it runs inside the live-server iframe
- **THEN** it cannot read the dashboard's `localStorage` (opaque origin)
- **AND** its calls to dashboard APIs are not authenticated with the dashboard session

#### Scenario: Sandbox does not self-disable
- **WHEN** the live-server iframe is rendered
- **THEN** its `sandbox` token set is exactly `allow-scripts`, `allow-forms`, `allow-popups`, `allow-downloads`
- **AND** its `sandbox` attribute does NOT include `allow-same-origin`

#### Scenario: User-initiated export from an embedded app reaches the user
- **GIVEN** a loopback app viewed in the live-server pane whose button triggers a file download (e.g. a blob `<a download>` click)
- **WHEN** the user clicks that button inside the frame
- **THEN** the browser performs the download rather than dropping it silently

### Requirement: CORS SHALL reject the opaque `null` origin

The dashboard CORS policy SHALL NOT allow requests whose `Origin` header is `null`, so a
sandboxed opaque-origin document cannot call dashboard APIs cross-origin. This is
additive to the existing localhost + `*.share.zrok.io` allowance.

#### Scenario: null-origin API call rejected
- **WHEN** a request arrives at a dashboard `/api/*` route with `Origin: null`
- **THEN** the server SHALL NOT return an `Access-Control-Allow-Origin` matching `null`
- **AND** the cross-origin call SHALL be rejected

### Requirement: Non-embeddable targets fall back gracefully

The viewer SHALL show a fallback with an "open in new tab" affordance
(`rel="noopener noreferrer"`) rather than a blank frame when a target cannot be embedded
(e.g. an external URL that sends `X-Frame-Options`/`frame-ancestors` refusing to be
framed, or a non-loopback address).

#### Scenario: Framing-refused target shows fallback
- **WHEN** a target refuses to be framed
- **THEN** the viewer shows an "open in new tab" fallback instead of a blank iframe

### Requirement: LiveServerViewer auto-launches a preset target

`LiveServerViewer` SHALL accept a preset target through `ViewerProps.path` encoded as a `live:<url>` sentinel. When `path` carries a concrete `http(s)` loopback URL, the viewer SHALL parse its host and port, call `startLiveServer` immediately, and embed the proxied preview WITHOUT first showing the target-picker screen. The embedded iframe `src` SHALL include the original URL's `pathname` and `search` appended to the proxied `/live/<id>/` mount, so a deep link opens the linked page rather than the app root.

The existing picker entry point (`path === "live:preview"`, or no url payload) SHALL be unchanged: the viewer boots to its target picker as today.

#### Scenario: preset target launches without the picker
- **GIVEN** the `live-server` viewer opened with `path="live:http://localhost:50452/report.html"`
- **WHEN** the viewer mounts
- **THEN** `startLiveServer` SHALL be called with host `localhost` and port `50452`
- **AND** the target picker SHALL NOT be shown
- **AND** the iframe `src` SHALL include the path `/report.html`

#### Scenario: picker entry point unchanged
- **GIVEN** the `live-server` viewer opened with `path="live:preview"`
- **WHEN** the viewer mounts
- **THEN** the target-picker screen SHALL render as today

#### Scenario: preset target still gated by the server SSRF check
- **GIVEN** a preset `path` whose host is not loopback (a mis-route)
- **WHEN** the viewer attempts to launch it
- **THEN** the server `validateLiveTarget` SHALL reject it
- **AND** the viewer SHALL show its existing error state (no embed)

### Requirement: In-viewer escape to the system browser

The `LiveServerViewer` preview header SHALL provide an affordance that opens the currently previewed target in the system browser (`target="_blank"`), so a user who auto-opened a loopback link in the split viewer can still hand it to a full browser.

#### Scenario: open-in-browser from the viewer header
- **GIVEN** a loopback target previewed in the `live-server` viewer
- **WHEN** the user activates the header's open-in-browser affordance
- **THEN** the target SHALL open in a system-browser tab

### Requirement: Declared servers are dashboard-probed for loopback, never auto-detected

The dashboard SHALL NOT auto-detect agent-started servers from tool output (the announced host is
untrusted — e.g. `serve_mockup` binds `0.0.0.0` but announces `localhost`, and `npm run dev`
emits no structured signal). A server SHALL reach the canvas only via
`canvas({ target: { kind:"server", port } })` or the existing manual `LiveServerViewer`. A
declared server SHALL surface a confirm chip **without any pre-confirm fetch or probe** of the
agent-supplied port. The loopback probe of `127.0.0.1:port` SHALL happen only on chip tap (the
explicit-confirm gesture), reusing the existing allowlist-add endpoint, and SHALL NOT trust an
agent-announced host. This preserves the invariant that targets are never fetched automatically
from agent-supplied input (no auto-fetch precedes explicit confirmation).

#### Scenario: Chip surfaces without a pre-confirm probe
- **WHEN** the agent calls `canvas({ target: { kind:"server", port: 5173 } })`
- **THEN** a confirm chip surfaces with no fetch or probe of port 5173
- **AND** the dashboard probes `127.0.0.1:5173` only when the user taps the chip

#### Scenario: Announced host is never trusted
- **GIVEN** a tool announced a server at `http://localhost:5173` while actually binding `0.0.0.0`
- **WHEN** any server path runs
- **THEN** the dashboard relies on its own `127.0.0.1:5173` probe, not the announced host, and no auto-open occurs

#### Scenario: No structured-signal server is simply not surfaced
- **WHEN** the agent starts `npm run dev` (no declare, no structured signal)
- **THEN** no chip appears automatically; the user opens it via the manual `LiveServerViewer` or the agent declares it

### Requirement: Confirm chip re-validates liveness on tap and expires

The server confirm chip SHALL carry the declared server's identity and SHALL probe that
`127.0.0.1:port` is a live loopback listener **at tap time** (the first and only probe) before
opening. On **connection-refused** it SHALL immediately show a "server not running" state; on a
probe exceeding **3000ms** it SHALL show a "server not responding" state. It SHALL NOT open an
iframe in either case. The chip SHALL expire at the turn boundary or on a server-exit signal, so
a stale chip cannot open an unintended process later holding the same port.

#### Scenario: Refused connection shows 'not running' immediately
- **GIVEN** a confirm chip for a declared port whose server has exited (connection refused)
- **WHEN** the user taps it
- **THEN** the dashboard shows a "server not running" state at once, no iframe

#### Scenario: Unresponsive port times out at 3000ms
- **GIVEN** a confirm chip for a port that accepts the connection but never responds
- **WHEN** the user taps it
- **THEN** after 3000ms the dashboard shows a "server not responding" state, no iframe

#### Scenario: Chip expires at turn boundary
- **WHEN** the turn that produced the chip ends or a server-exit signal fires
- **THEN** the chip is no longer actionable

### Requirement: Previews authenticate through a per-preview capability path
Because the preview frame has an opaque origin, its subresource, fetch and WebSocket requests carry no dashboard cookie. The server SHALL therefore offer a **capability path** for each live-server target:

- **Mint.** `POST /api/live-server/:id/capability` SHALL return `{ path: "/live/<id>/~c/<token>/", expiresAt }` for a caller that passes the existing admission rules and holds at least the `control` tier; an unknown `id` SHALL return 404. The token SHALL be at least 128 bits of randomness, stored server-side only as a hash, and bound to that target id and to the minting principal (device id, login session, or local caller).
- **Accept.** An HTTP request (any method) or a `live`-scope WebSocket upgrade whose raw pathname begins with exactly the segments `live`, `<id>`, `~c`, `<token>` followed by `/` — compared segment by segment on the raw (not dot-resolved) pathname, with no dot-segment and no percent-encoded `/`, `~` or `.` anywhere in it — and whose token is valid for that same `<id>` SHALL be admitted as authenticated, carrying the minting principal's identity and tier. The token SHALL authorize nothing else — no other target id and no path outside `/live/<id>/~c/<token>/`. On a WebSocket upgrade the token is read from the same path segment (never a query parameter or subprotocol). When the identity floor requires a principal-bearing credential for the `live` scope, a capability SHALL satisfy it only if it was minted by an identity principal.
- **Lifetime.** A token SHALL expire after 30 minutes without an accepted request and in any case 12 hours after minting, and SHALL be invalidated when its target is removed, its minting device is revoked, its minting session ends, or the server restarts. Each accepted request SHALL extend the idle expiry.
- **Refusal.** A missing, unknown, expired or wrong-target token SHALL be refused by the normal admission rules (no credential) and SHALL NOT be distinguishable from an unknown token to the caller.
- **Forwarding.** The proxy SHALL remove the `/~c/<token>` segment from the forwarded path and from a forwarded `Referer` header, SHALL rewrite upstream redirects into the capability prefix, and SHALL add `Referrer-Policy: no-referrer` to proxied responses that set no referrer policy. Server logs SHALL redact the token.

`expiresAt` SHALL be the token's absolute expiry. The viewer SHALL mint a capability before framing a target and frame the returned path; it SHALL mint a fresh one, and re-point the frame to it, on every reopen of the target and 10 minutes before `expiresAt`. Existing `/live/<id>/` admission (genuine local, `legacy` network trust, OAuth session) is unchanged.

#### Scenario: Paired LAN browser previews with HMR in pair mode
- **GIVEN** effective trust mode `"pair"` and a browser on `192.168.16.20` holding a `control`-tier device cookie
- **WHEN** the viewer mints a capability for target `vite-5173` and frames the returned path
- **THEN** the page, its scripts and images, its fetches and its HMR WebSocket under that path SHALL all be admitted

#### Scenario: Observe-tier device cannot mint
- **WHEN** a request authenticated by an `observe` device credential calls `POST /api/live-server/vite-5173/capability`
- **THEN** it SHALL be refused with 403 `insufficient_scope` and no token SHALL be created

#### Scenario: Token is bound to one target
- **GIVEN** a valid capability for target `vite-5173`
- **WHEN** a request uses that token under `/live/docs-8080/~c/<token>/`
- **THEN** it SHALL NOT be admitted by the capability

#### Scenario: Token never reaches the API
- **WHEN** a request to `/api/sessions` carries a capability token in its path, query or headers
- **THEN** the token SHALL NOT authenticate it

#### Scenario: Mangled capability paths are refused
- **WHEN** a request uses `/live/vite-5173/~c/<token>evil/`, `/live/vite-5173/%7Ec/<token>/`, `/live/vite-5173/x/../~c/<token>/` or `/live/vite-5173/~c/<token>` (no trailing segment separator)
- **THEN** none SHALL be admitted by the capability

#### Scenario: Identity floor accepts only identity-minted capabilities
- **GIVEN** the identity floor is enforced
- **WHEN** a live upgrade presents a capability minted by a paired device without an identity principal
- **THEN** it SHALL be refused
- **AND** a capability minted by an identity principal SHALL be admitted

#### Scenario: Idle expiry
- **GIVEN** a capability unused for 30 minutes
- **WHEN** a request uses it
- **THEN** it SHALL NOT be admitted by the capability

#### Scenario: Viewer re-mints before absolute expiry
- **GIVEN** a framed capability whose `expiresAt` is 12 h after minting
- **WHEN** 11 h 50 min have elapsed with the viewer open
- **THEN** the viewer SHALL have minted a new capability and re-pointed the frame to its path

#### Scenario: Revoking the device kills its previews
- **GIVEN** a capability minted by device A
- **WHEN** device A is revoked
- **THEN** the next request using that capability SHALL NOT be admitted

#### Scenario: Upstream sees the plain path
- **WHEN** `GET /live/vite-5173/~c/<token>/src/main.ts` is proxied
- **THEN** the upstream SHALL receive `GET /src/main.ts`

#### Scenario: Redirect stays inside the capability
- **WHEN** the upstream answers `302 Location: /login`
- **THEN** the browser SHALL receive `Location: /live/vite-5173/~c/<token>/login`

#### Scenario: Token not leaked by referrer or logs
- **WHEN** a proxied page without its own referrer policy links to a third-party site
- **THEN** the response SHALL have carried `Referrer-Policy: no-referrer`
- **AND** no server log line SHALL contain the token

### Requirement: Dashboard credentials never reach the preview upstream
The `/live/*` proxy SHALL remove dashboard credentials from every forwarded HTTP request and WebSocket upgrade: the dashboard login-session cookie (`pi_dash_token`, `Path=/`, sent today) and — as defense in depth against crafted clients — the `pi_dash_device` cookie SHALL be removed from the `Cookie` header (dropping the header only when nothing remains), and an `Authorization` header SHALL be removed when it carries a dashboard device bearer. Every other cookie and header SHALL be forwarded unchanged, so the previewed app keeps its own session. In the other direction, the proxy SHALL drop any upstream `Set-Cookie` that names a dashboard cookie (`pi_dash_` prefix), so a previewed app cannot plant or overwrite a dashboard credential.

#### Scenario: Dashboard cookies stripped, app cookie kept (HTTP)
- **WHEN** a request carrying `pi_dash_device=…; pi_dash_token=…; myapp_session=abc` is proxied
- **THEN** the upstream SHALL receive `Cookie: myapp_session=abc`

#### Scenario: Dashboard cookies stripped on upgrade
- **WHEN** a live WebSocket upgrade carrying the dashboard session cookie is forwarded
- **THEN** the upstream upgrade request SHALL NOT contain it

#### Scenario: Upstream cannot plant a dashboard cookie
- **WHEN** the upstream responds with `Set-Cookie: pi_dash_token=attacker; Path=/` and `Set-Cookie: myapp_session=x`
- **THEN** the browser SHALL receive only the `myapp_session` cookie

#### Scenario: App bearer kept
- **WHEN** a proxied request carries `Authorization: Bearer <app token>` that is not a dashboard device bearer
- **THEN** the upstream SHALL receive it unchanged
