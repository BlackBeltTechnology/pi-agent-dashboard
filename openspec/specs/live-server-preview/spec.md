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

The server SHALL accept live-server **port** targets **only** for loopback hosts
(`127.0.0.1`, `::1`, `localhost`), never on a port the dashboard itself listens on. Only ports the
user has explicitly added SHALL be written to the persisted allowlist. A loopback server or URL
declared by the agent SHALL be fetched only after the user taps its confirm chip, and SHALL then
register an in-memory preset target that is never persisted and is served under the restricted
preview policy. Any non-loopback host, cloud-metadata address, or unconfirmed free-form port target
SHALL be rejected. Port targets SHALL never be fetched automatically from tree contents or
agent-supplied input. **Static**
targets make no network request: they serve files admitted by the raw file-read gate, are never
persisted, and MAY be registered for an agent-declared or auto-opened file.

#### Scenario: Loopback target accepted
- **WHEN** the client requests a proxy for `127.0.0.1:5173` present in the allowlist
- **THEN** the server returns a proxied path

#### Scenario: Remote host rejected
- **WHEN** the client requests a proxy for a non-loopback host (e.g. `10.0.0.5:80` or `169.254.169.254`)
- **THEN** the server rejects the request and creates no proxy

#### Scenario: Unconfirmed port rejected
- **WHEN** the client requests a proxy for a loopback port not on the allowlist
- **THEN** the server rejects the request until the user confirms/adds the target

#### Scenario: Agent-declared loopback URL waits for confirmation and is not persisted
- **WHEN** the agent declares `http://localhost:54321/`
- **THEN** a confirm chip appears and nothing is fetched
- **AND** after the user taps it, a preset target serves it under the restricted policy
- **AND** after a server restart the allowlist does not contain port 54321

#### Scenario: Dashboard's own port refused
- **GIVEN** the dashboard listens on port 8000
- **WHEN** a target for `localhost:8000` is requested by any path
- **THEN** it is refused

#### Scenario: Static target for an admitted file
- **GIVEN** session cwd `/p` and file `/p/mockups/a/index.html`
- **WHEN** the client requests a static target for that file
- **THEN** the server registers a static target and returns its proxied path
- **AND** the persisted allowlist is unchanged, also after a server restart

#### Scenario: Static target outside admitted roots refused
- **WHEN** the client requests a static target for a file that a raw file read of the same cwd and path would refuse
- **THEN** the server refuses it with the same status and registers nothing

### Requirement: Embedded content SHALL be origin-isolated via sandbox

Proxied live-server content SHALL be reverse-proxied on the dashboard's main origin at a
path (e.g. `/live/<id>/`, mirroring `/editor/<id>/`) so it is reachable both locally and
over the single-port remote tunnel. The viewer SHALL embed it with exactly
`sandbox="allow-scripts allow-forms allow-popups allow-downloads"` and SHALL NOT set
`allow-same-origin`, so the browser assigns the framed document a unique opaque origin.
The `allow-scripts` and `allow-same-origin` tokens SHALL NOT both be present. The sandbox
SHALL NOT include `allow-downloads-without-user-activation`. Under the restricted preview
policy the sandbox SHALL omit `allow-popups` and `allow-downloads`, and with scripts off it SHALL be empty.
Note that the browser sandbox
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
- **WHEN** the live-server iframe is rendered under the open policy with scripts
- **THEN** its `sandbox` token set is exactly `allow-scripts`, `allow-forms`, `allow-popups`, `allow-downloads`
- **AND** its `sandbox` attribute does NOT include `allow-same-origin`

#### Scenario: User-initiated export from an embedded app reaches the user
- **GIVEN** a loopback app viewed in the live-server pane whose button triggers a file download (e.g. a blob `<a download>` click)
- **WHEN** the user clicks that button inside the frame
- **THEN** the browser performs the download rather than dropping it silently

#### Scenario: Restricted target has no popups or downloads
- **WHEN** a target is framed under the restricted policy with scripts
- **THEN** its `sandbox` token set is exactly `allow-scripts`, `allow-forms`

#### Scenario: Scripts-off static target has an empty sandbox
- **GIVEN** a static target framed with scripts
- **WHEN** the user switches the viewer to "Static (no scripts)"
- **THEN** the frame's `sandbox` attribute is present and empty
- **AND** a `<script>` in the document does not execute

#### Scenario: Toggle back restores the same egress
- **GIVEN** an operator-opened static target switched to "Static (no scripts)"
- **WHEN** the user switches back to scripts
- **THEN** the preview runs scripts with open egress again

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

`LiveServerViewer` SHALL accept a preset target through `ViewerProps.path` encoded as a `live:<url>` sentinel. When `path` carries a concrete `http(s)` loopback URL, the viewer SHALL parse its host and port, call `startLiveServer` immediately, and embed the proxied preview WITHOUT first showing the target-picker screen. The embedded iframe `src` SHALL be the minted capability path with the original URL's `pathname` and `search` appended after the address-path validation, so a deep link opens the linked page rather than the app root.

The existing picker entry point (`path === "live:preview"`, or no url payload) SHALL be unchanged: the viewer boots to its target picker as today.

#### Scenario: preset target launches without the picker
- **GIVEN** the `live-server` viewer opened with `path="live:http://localhost:50452/report.html"`
- **WHEN** the viewer mounts
- **THEN** `startLiveServer` SHALL be called with host `localhost` and port `50452`
- **AND** the target picker SHALL NOT be shown
- **AND** the iframe `src` SHALL be under the minted capability path and include `/report.html`

#### Scenario: picker entry point unchanged
- **GIVEN** the `live-server` viewer opened with `path="live:preview"`
- **WHEN** the viewer mounts
- **THEN** the target-picker screen SHALL render as today

#### Scenario: preset target still gated by the server SSRF check
- **GIVEN** a preset `path` whose host is not loopback (a mis-route)
- **WHEN** the viewer attempts to launch it
- **THEN** the server `validateLiveTarget` SHALL reject it
- **AND** the viewer SHALL show its existing error state (no embed)

#### Scenario: preset deep path is validated
- **GIVEN** a preset `path="live:http://localhost:50452/a/%2e%2e/%2e%2e/x"`
- **WHEN** the viewer mounts
- **THEN** it shows the invalid-path message and frames nothing

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
`canvas({ target: { kind:"server", port } })`, a `canvas` loopback `kind:"url"` declare, or the
existing manual `LiveServerViewer`. A declared server or loopback URL SHALL surface a confirm chip
**without any pre-confirm fetch or probe** of the agent-supplied port. The loopback probe of
`127.0.0.1:port` SHALL happen only on chip tap (the explicit-confirm gesture) and SHALL NOT trust an
agent-announced host. On a successful probe the tap SHALL register an in-memory preset target and
open it under the restricted preview policy, at the declared path for a URL declare. This preserves
the invariant that targets are never fetched automatically from agent-supplied input.

#### Scenario: Chip surfaces without a pre-confirm probe
- **WHEN** the agent calls `canvas({ target: { kind:"server", port: 5173 } })`
- **THEN** a confirm chip surfaces with no fetch or probe of port 5173
- **AND** the dashboard probes `127.0.0.1:5173` only when the user taps the chip

#### Scenario: Loopback URL declare uses the chip
- **WHEN** the agent calls `canvas({ target: { kind:"url", url:"http://localhost:5173/dashboard" } })`
- **THEN** a confirm chip surfaces with no fetch or probe
- **AND** tapping it opens `/dashboard` of a restricted preset target

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

- **Policy.** The mint SHALL accept an egress policy (`open` or `restricted`) and, for static targets, a scripts flag. An absent or invalid egress SHALL mean `restricted`; an absent scripts flag SHALL mean scripts off. The token SHALL carry the policy, and every response served under it SHALL apply it; no request path, query or header SHALL change it.
- **Static targets.** A token for a static target SHALL expire after 10 minutes without an accepted request and in any case 2 hours after minting.
- **Local binding.** A token minted by a genuinely local caller SHALL be accepted only from genuinely local requests.
- **Exposure.** A restricted, scripts-on token minted while the dashboard was reachable only from this machine SHALL be invalidated when it becomes reachable from elsewhere.

- **Keepalive.** A mounted, visible viewer MAY extend its token's idle expiry without changing the framed URL.

`expiresAt` SHALL be the token's absolute expiry. The viewer SHALL mint a capability before framing a target and frame the returned path; it SHALL mint a fresh one, and re-point the frame to it, on every reopen of the target and 10 minutes before `expiresAt`. Existing `/live/<id>/` admission (genuine local, `legacy` network trust, OAuth session) is unchanged for requests without browser markers; browser-originated requests require a capability.

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

#### Scenario: Mint without policy is restricted
- **WHEN** a capability for a static target is minted with an empty body
- **THEN** its token carries egress `restricted` and scripts off

#### Scenario: Static token expires sooner
- **GIVEN** a static-target capability unused for 10 minutes
- **WHEN** a request uses it
- **THEN** it SHALL NOT be admitted by the capability

#### Scenario: Local token refused remotely
- **GIVEN** a capability minted by a genuinely local caller
- **WHEN** a request through a tunnel presents it
- **THEN** it SHALL NOT be admitted by the capability

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

### Requirement: Static targets resolve a capped document root

For a file inside the session working directory, a static target's root SHALL be the nearest ancestor of the file's directory, inclusive, containing `index.html` or `package.json`, searched no higher than the working directory; when none exists, the root SHALL be the file's own directory. For a granted file outside the working directory, the root SHALL be the file's own directory. The frame SHALL open at the file's root-relative path.

#### Scenario: Mockup directory with index.html becomes the root
- **GIVEN** `/p/mockups/a/index.html` and `/p/mockups/a/screens/b.html`
- **WHEN** a static target is requested for `screens/b.html`
- **THEN** the root is `/p/mockups/a` and the frame opens `screens/b.html`
- **AND** a stylesheet linked as `../style.css` from `b.html` loads

#### Scenario: No marker keeps the root at the file's directory
- **GIVEN** session cwd `/p` with no `index.html` or `package.json` between `/p/docs/r` and `/p`
- **WHEN** a static target is requested for `/p/docs/r/report.html`
- **THEN** the root is `/p/docs/r`

#### Scenario: Granted file outside cwd does not climb
- **GIVEN** a granted file `/shared/out/report.html` outside session cwd `/p`
- **WHEN** a static target is requested for it
- **THEN** the root is `/shared/out`

### Requirement: Static requests are re-checked against file access on every request

Every request served by a static target SHALL pass the same file-read access check as a raw read of that file in the target's session working directory, evaluated at request time, so a revoked grant stops serving on the next request.

#### Scenario: Revoked grant stops serving
- **GIVEN** a static target for a granted file outside the cwd, framed and loading
- **WHEN** the grant is revoked on the Access page and the frame reloads
- **THEN** the file is no longer served

#### Scenario: File-only grant does not expose siblings
- **GIVEN** a grant for `/shared/out/report.html` only
- **WHEN** `/shared/out/other.html` is requested through its static target
- **THEN** the response is 404

### Requirement: Browser-originated live requests require a capability

A `/live/` HTTP request or WebSocket upgrade that carries `Origin: null` or any `Sec-Fetch-*` header SHALL be served only with a valid capability for that target; otherwise it SHALL return 404, including for genuinely local callers. A static target SHALL require a valid capability from every caller. Requests without browser markers to port targets SHALL keep the existing admission.

#### Scenario: Opaque frame without token refused
- **GIVEN** a registered port target `vite-5173`
- **WHEN** a sandboxed frame on this machine requests `/live/vite-5173/` without a capability
- **THEN** the response is 404

#### Scenario: Local tool without browser markers unchanged
- **WHEN** a local non-browser client requests `/live/vite-5173/` without browser markers
- **THEN** it is admitted as today

#### Scenario: Static target needs a token from anyone
- **WHEN** a local non-browser client requests a static target path without a capability
- **THEN** the response is 404

### Requirement: Static targets serve only contained web assets

A static target SHALL serve a request only when the real path of the requested file lies inside the real path of its root and its extension is a web asset type (markup, style, script, JSON, image, font, audio, video). Paths with a dot-prefixed, `.git` or `node_modules` segment, a forbidden subject, or a credential-like name SHALL return 404, as SHALL missing files and any other type.

#### Scenario: Symlink escape refused
- **GIVEN** `root/link.html` is a symlink to `/etc/hosts`
- **WHEN** it is requested through the static target
- **THEN** the response is 404

#### Scenario: Dotfile and credential files refused
- **WHEN** `root/.env`, `root/config/secrets.json`, `root/certs/server.pem`, `root/auth.json`, `root/service-account-prod.json`, `root/api-token.json` or `root/app.js.map` is requested
- **THEN** each response is 404

#### Scenario: Non-web type refused
- **WHEN** `root/data/dump.sqlite` is requested through the static target
- **THEN** the response is 404

#### Scenario: Encoded traversal refused
- **WHEN** a request path contains `%2e%2e/` or `..%2f` below the capability prefix
- **THEN** it is not served from outside the root

### Requirement: Static responses are uncached and type-safe

Every served static file SHALL carry its MIME type, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.

#### Scenario: Stylesheet headers
- **WHEN** `root/style.css` is served
- **THEN** the response has `Content-Type: text/css`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`

### Requirement: Capability responses enforce the sandbox themselves

Every response served under a capability, for port and static targets, SHALL carry a `Content-Security-Policy` whose `sandbox` directive matches the frame's sandbox for that preview's policy, together with `object-src 'none'` and `frame-ancestors 'self'`, so opening the served URL directly in a browser tab still yields an opaque-origin document.

#### Scenario: Direct open stays sandboxed
- **GIVEN** a capability URL of a static or port target
- **WHEN** it is opened in a new top-level browser tab
- **THEN** the document has an opaque origin and cannot read dashboard `localStorage`

### Requirement: Open in browser uses the real local address for local operators

For a port target the user added, viewed by a genuinely local operator, the open-in-browser affordance SHALL open the target's own `http://localhost:<port>/<path>` address. For agent-declared preset targets, static targets and remote operators it SHALL open a freshly minted capability URL.

#### Scenario: Local operator opens the dev server itself
- **GIVEN** a local operator viewing port target `localhost:5173` at `/dashboard`
- **WHEN** they activate open-in-browser
- **THEN** `http://localhost:5173/dashboard` opens

#### Scenario: Agent server never opens on a loopback origin
- **GIVEN** a local operator viewing an agent-declared preset target `localhost:54321`
- **WHEN** they activate open-in-browser
- **THEN** a capability URL opens, not `http://localhost:54321/`

### Requirement: The viewer header is an editable address bar

The framed viewer SHALL show the target's entry address in an editable field: the root-relative path for a static target, `http://host:port/path` for a port target. A submitted path within the same target SHALL re-point the frame without registering a target. A different loopback host or port SHALL ask for inline confirmation and then use the existing start gate. A non-loopback address SHALL be refused.

#### Scenario: Navigate to a sibling page
- **GIVEN** a static target framed at `index.html`
- **WHEN** the user edits the address to `screens/b.html` and submits
- **THEN** the frame shows `screens/b.html` and no new target is registered

#### Scenario: New loopback port needs confirmation
- **GIVEN** a port target at `http://localhost:5173/`
- **WHEN** the user submits `http://localhost:5174/`
- **THEN** an inline confirmation is shown before any target is added

#### Scenario: Remote address refused
- **WHEN** the user submits `http://10.0.0.5/`
- **THEN** the viewer shows the loopback-only error and the frame is unchanged

### Requirement: Address bar paths are validated before use

A path submitted in the address bar, or carried by a preset target, SHALL be applied only after validation: an empty path means the root and one trailing `/` is allowed; otherwise it SHALL be rejected when any segment is empty, `.`, `..`, or contains a backslash or control character; each segment SHALL be percent-encoded.

#### Scenario: Dot-segment address refused
- **WHEN** the user submits `../../api/sessions` for a static target
- **THEN** the viewer shows an invalid-path message and the frame is unchanged

#### Scenario: Root and trailing slash accepted
- **WHEN** the user submits an empty address or `screens/`
- **THEN** the frame shows the root or the `screens/` path

### Requirement: The viewer reloads on demand and on canvas re-declare

The framed viewer SHALL provide a reload control. Every reload SHALL frame a capability minted under the tab's current policy and the current exposure. When the canvas re-declares the target of an open tab with a higher version, a background tab SHALL reload, and the active tab SHALL instead show a non-modal "Updated by the agent" notice with a reload action, leaving the content undisturbed.

#### Scenario: Background tab reloads
- **GIVEN** a canvas target open in a tab that is not active
- **WHEN** the agent declares the same target again with a higher version
- **THEN** that tab's frame reloads and no second tab is opened

#### Scenario: Active tab offers reload
- **GIVEN** the user is viewing the canvas target's tab
- **WHEN** the agent declares the same target again with a higher version
- **THEN** the content is unchanged and an "Updated by the agent" notice with Reload appears

#### Scenario: Reload after exposure change drops scripts
- **GIVEN** an auto-opened scripted preview minted while local-only
- **WHEN** a tunnel starts and the user reloads
- **THEN** the frame is re-minted without scripts

### Requirement: The target picker leads with live targets

The target picker SHALL list the session's active canvas target first, then port targets the user added manually. Agent-declared preset targets and targets persisted before this requirement SHALL be grouped under a collapsed "Older targets" disclosure offering "Clear all", which SHALL ask for confirmation. Removing a listed target SHALL revoke its capabilities and, when persisted, delete its allowlist entry. The user's manual additions SHALL survive a server restart as manual.

#### Scenario: Stale ports hidden by default
- **GIVEN** ten targets from earlier automatic launches and one manually added target
- **WHEN** the picker opens
- **THEN** the manual target is visible and the ten are inside the collapsed "Older targets" group

#### Scenario: Manual target stays manual after restart
- **GIVEN** a target the user added manually
- **WHEN** the server restarts and the picker opens
- **THEN** the target is listed among the user's targets, not under "Older targets"

#### Scenario: Remove a target
- **WHEN** the user removes a listed target
- **THEN** it disappears from the picker and a framed preview using its capability stops loading

### Requirement: Root-absolute pages explain how to view them

When a static target's document references root-absolute paths, the viewer SHALL explain that those resources cannot resolve inside the preview and that the page should be run with a dev server bound to localhost and opened by its localhost URL.

#### Scenario: Hint for root-absolute assets
- **GIVEN** a static target whose page references `/app.js`
- **WHEN** it is framed
- **THEN** the viewer shows the root-absolute hint

### Requirement: In-memory preview targets are bounded per session

A session SHALL hold at most 16 preset targets and 32 static targets. Registering beyond a bound SHALL evict the least recently used target of that kind and revoke its capabilities.

#### Scenario: Seventeenth preset evicts the oldest
- **GIVEN** a session with 16 preset targets
- **WHEN** a 17th is registered
- **THEN** the least recently used preset is removed and its framed preview stops loading

### Requirement: Static files stream without a size cap

A static target SHALL serve an allowed file of any size by streaming it and SHALL honour single `Range` requests with `206 Partial Content`.

#### Scenario: Large video plays with seeking
- **GIVEN** a 60 MB `root/media/demo.webm` referenced by the page (`.webm` is allowed as media)
- **WHEN** the browser requests `Range: bytes=1000000-`
- **THEN** the response is `206` with the requested bytes

### Requirement: Static serving overhead is bounded

For a target whose `cwd` is admitted by direct match, the first serve of an HTML document, including its origin scan, SHALL add at most 150 ms at the 95th percentile over a plain read of the same file, for a 2 MiB document linking 10 same-root stylesheets. The per-request access re-check SHALL add at most 10 ms at the 95th percentile for a target whose `cwd` the shared cwd admission guard admits by direct match (a known folder: session cwd, pinned directory or workspace folder). For a target whose `cwd` is admitted only through its repository's main checkout, the first serve and every re-check include a git derivation and SHALL each be bounded by the admission deadline instead.

#### Scenario: Scan overhead within budget
- **GIVEN** a static target whose `cwd` is a known folder (session cwd, pinned directory or workspace folder), and a 2 MiB HTML document linking 10 same-root stylesheets
- **WHEN** it is first served 50 times under a restricted capability (fresh target each time)
- **THEN** the 95th-percentile added time over a plain read is at most 150 ms

#### Scenario: Gate overhead within budget
- **GIVEN** a static target whose `cwd` is a known folder (session cwd, pinned directory or workspace folder), serving a 20 KB stylesheet
- **WHEN** it is requested 200 times
- **THEN** the 95th-percentile time spent in the access re-check is at most 10 ms

#### Scenario: Derived-worktree target re-check is bounded by the admission deadline
- **GIVEN** a static target whose `cwd` is a sessionless linked worktree of a pinned repository
- **WHEN** an asset is requested
- **THEN** the access re-check SHALL complete within the admission deadline, and an undecidable admission SHALL refuse the asset
