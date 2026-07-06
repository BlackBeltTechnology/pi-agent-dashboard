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
over the single-port remote tunnel. The viewer SHALL embed it with
`sandbox="allow-scripts"` and SHALL NOT set `allow-same-origin`, so the browser assigns
the framed document a unique opaque origin. The `allow-scripts` and `allow-same-origin`
tokens SHALL NOT both be present. Consequently the embedded app SHALL NOT be able to read
the dashboard's `localStorage`/auth token or make same-origin credentialed calls to the
dashboard APIs. Isolation by a distinct port or hostname SHALL NOT be used, because the
remote tunnel exposes a single port/host.

#### Scenario: Embedded app cannot access the dashboard origin
- **GIVEN** a malicious page served by the previewed dev server that reads
  `window.localStorage` and calls `/api/restart`
- **WHEN** it runs inside the live-server iframe
- **THEN** it cannot read the dashboard's `localStorage` (opaque origin)
- **AND** its calls to dashboard APIs are not authenticated with the dashboard session

#### Scenario: Sandbox does not self-disable
- **WHEN** the live-server iframe is rendered
- **THEN** its `sandbox` attribute includes `allow-scripts`
- **AND** its `sandbox` attribute does NOT include `allow-same-origin`

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

