## Purpose

Closes DNS rebinding against the dashboard: admits an HTTP request or WebSocket upgrade only when its `Host` header names a hostname the dashboard can justify answering on, independent of whether the request carries an `Origin`.

## ADDED Requirements

### Requirement: Every request is checked against an admissible-hostname set
The dashboard listener SHALL evaluate the `Host` header of every HTTP request and every WebSocket upgrade — including requests that carry no `Origin` header — against a set of admissible hostnames. The check SHALL run before CORS headers are produced and before any `Origin`-based admission, on every path, regardless of whether OAuth is configured, in addition to (never instead of) the existing authentication and network admission. Matching SHALL be on the hostname alone (port stripped, IPv6 brackets stripped, trailing dot stripped, case-insensitive); the port SHALL NOT participate in the decision. A request with no `Host` header, or a `Host` header that does not parse as a hostname or IP literal, SHALL be treated as not admissible.

#### Scenario: Rebinding page cannot read without an Origin
- **WHEN** enforcement is on and `GET /api/sessions` arrives from a loopback peer with `Host: rebind.example:8000` and no `Origin` header
- **THEN** the server SHALL respond `403` and SHALL NOT serve the resource

#### Scenario: Rebinding page cannot mutate
- **WHEN** enforcement is on and `POST /api/tunnel-connect` arrives from a loopback peer with `Host: rebind.example:8000` and `Origin: http://rebind.example:8000`
- **THEN** the server SHALL respond `403` and the route handler SHALL NOT run

#### Scenario: Rebinding page cannot open a WebSocket
- **WHEN** enforcement is on and a WebSocket upgrade for `/ws` arrives from a loopback peer with `Host: rebind.example:8000` and `Origin: http://rebind.example:8000`
- **THEN** the server SHALL respond `HTTP/1.1 403`, destroy the socket, and any single-use ticket on the request SHALL remain unconsumed

#### Scenario: Port does not affect the decision
- **WHEN** `dash.home.arpa` is admissible and a request arrives with `Host: dash.home.arpa:9443`
- **THEN** the request SHALL be admitted

#### Scenario: IPv6 literal Host is normalised
- **WHEN** a request arrives with `Host: [::1]:8000`
- **THEN** the hostname `::1` SHALL be admitted as loopback

#### Scenario: Missing or malformed Host fails closed
- **WHEN** enforcement is on and a request arrives with no `Host` header, or with `Host: evil.example/@localhost`
- **THEN** the server SHALL respond `403`

### Requirement: Admissible hostnames are derived from what the dashboard already answers on
A hostname SHALL be admissible when any of the following holds, each evaluated against current (not boot-time) state: it is a loopback literal (`localhost`, `127.0.0.1`, `::1`), any IPv4 or IPv6 literal (`net.isIP` — strict forms; shorthand such as `127.1` is not an IP literal), or the address the listener was bound to; it is `<label>.local` with a non-empty label; it is the hostname of an entry in `publicBaseUrls` (including entries inherited from the legacy `pairing.publicBaseUrls` key); it is the hostname of an entry in `cors.allowedOrigins`; it is the hostname of a currently live tunnel origin; or it appears in the top-level `allowedHosts` config field. The set SHALL NOT be a separate copied list: a hostname admitted through `publicBaseUrls`, `cors.allowedOrigins`, or a live tunnel SHALL NOT need to be duplicated into `allowedHosts`, and removing the source entry SHALL remove the admission. A source entry that does not parse as a URL SHALL be skipped, not raise.

#### Scenario: Loopback and bind address are admitted
- **WHEN** the listener is bound to `dash-host` (a name) and requests arrive with `Host: localhost:8000`, `Host: 127.0.0.1:8000`, and `Host: dash-host:8000`
- **THEN** each SHALL be admitted

#### Scenario: Any IP literal is admitted on a wildcard bind
- **WHEN** the listener is bound to `0.0.0.0`, `trustedNetworks` is empty, and requests arrive with `Host: 192.168.1.50:8000` and `Host: [fe80::1]:8000`
- **THEN** each SHALL be admitted

#### Scenario: mDNS hostname is admitted
- **WHEN** a request arrives with `Host: mac.local:8000` and `mac.local` appears in no configuration
- **THEN** the request SHALL be admitted

#### Scenario: Bare `.local` is not admitted
- **WHEN** enforcement is on and a request arrives with `Host: .local:8000`
- **THEN** the server SHALL respond `403`

#### Scenario: Public base URL host is admitted without duplication
- **WHEN** `publicBaseUrls` contains `https://pi.example.com` and `allowedHosts` is absent, and a request arrives with `Host: pi.example.com`
- **THEN** the request SHALL be admitted

#### Scenario: Legacy pairing key still counts
- **WHEN** top-level `publicBaseUrls` is absent, `pairing.publicBaseUrls` contains `https://old.example.com`, and a request arrives with `Host: old.example.com`
- **THEN** the request SHALL be admitted

#### Scenario: Removing the public base URL removes the admission
- **WHEN** `https://pi.example.com` is removed from `publicBaseUrls` at runtime and `pi.example.com` is in no other source
- **THEN** the next request with `Host: pi.example.com` SHALL no longer be admitted, with no restart

#### Scenario: Configured CORS origin host is admitted
- **WHEN** `cors.allowedOrigins` contains `https://dash.example` and a request arrives with `Host: dash.example`
- **THEN** the request SHALL be admitted

#### Scenario: Live tunnel host is admitted
- **WHEN** the active tunnel origin is `https://abc.share.zrok.io` and a request arrives with `Host: abc.share.zrok.io`
- **THEN** the request SHALL be admitted

#### Scenario: Stranger tunnel host is not admitted
- **WHEN** no live tunnel has origin `https://xyz.share.zrok.io` and enforcement is on and a request arrives with `Host: xyz.share.zrok.io`
- **THEN** the server SHALL respond `403`

#### Scenario: allowedHosts entry is admitted and applies live
- **WHEN** `dash.home.arpa` is appended to `allowedHosts` while the server is running
- **THEN** the next request with `Host: dash.home.arpa` SHALL be admitted with no restart

### Requirement: Enforcement mode is switchable and defaults to report-only
The gate SHALL run in one of two modes, `report` or `enforce`, resolved in this order: the `PI_DASHBOARD_HOST_GATE` environment variable when it holds a recognised value (an unrecognised value contributes nothing and SHALL be logged once at boot); else the `hostGate.mode` config value read live; else `report`. In `report` a non-admissible Host is logged and the request proceeds; in `enforce` it is refused. A refused HTTP request SHALL receive `403` and no CORS headers; when the request's `Accept` header's first media type is `text/html` (absent `Accept`, `*/*`, or `application/json, text/html;q=0.9` select JSON) the body SHALL be a static HTML page that names the received `Host` (HTML-escaped), names `http://localhost:<port>` as the way in, and names `allowedHosts` and `publicBaseUrls` as the two ways to admit the name; it SHALL NOT enumerate admitted hostnames, tunnel origins, or bind addresses (the refused page is same-origin-readable by a rebinding page) and SHALL reference no script or asset served by the dashboard; otherwise the body SHALL be JSON `{ success: false, error: "host_not_allowed", reason: <human-readable>, hint: <names the config keys that would admit the host> }`. A refused WebSocket upgrade SHALL receive `HTTP/1.1 403` and the socket SHALL be destroyed.

#### Scenario: Report-only default lets the request through
- **WHEN** `PI_DASHBOARD_HOST_GATE` is unset and a request arrives with a non-admissible `Host`
- **THEN** the request SHALL be served normally and one refusal line SHALL be logged

#### Scenario: Enforce mode refuses with a self-describing body
- **WHEN** `PI_DASHBOARD_HOST_GATE=enforce` and `GET /api/health` arrives with `Host: rebind.example`
- **THEN** the response SHALL be `403` with `error: "host_not_allowed"` and a `hint` naming `allowedHosts` and `publicBaseUrls`, and SHALL carry no `Access-Control-Allow-Origin` header

#### Scenario: Unrecognised env value falls through to config
- **WHEN** `PI_DASHBOARD_HOST_GATE=yes` and `hostGate.mode` is absent
- **THEN** the gate SHALL behave as `report`
- **WHEN** `PI_DASHBOARD_HOST_GATE=yes` and `hostGate.mode` is `enforce`
- **THEN** the gate SHALL behave as `enforce`

#### Scenario: Config mode applies live and env overrides it
- **WHEN** `hostGate.mode` is changed to `enforce` in `config.json` while the server runs and the env var is unset
- **THEN** the next non-admissible request SHALL be refused with no restart
- **WHEN** `PI_DASHBOARD_HOST_GATE=report` is set and `hostGate.mode` is `enforce`
- **THEN** the gate SHALL behave as `report`

#### Scenario: Browser navigation gets the HTML refusal page
- **WHEN** `enforce` mode and `GET /` arrives with `Host: rebind.example:8000` and `Accept: text/html,*/*`
- **THEN** the response SHALL be `403` with `Content-Type: text/html`, the body SHALL contain `rebind.example:8000`, `localhost:8000`, `allowedHosts`, and `publicBaseUrls`, and SHALL contain no `<script>` and no `/assets/` reference

#### Scenario: Received Host is escaped in the HTML page
- **WHEN** `enforce` mode and `GET /` arrives with `Host: a<img>.example` and `Accept: text/html`
- **THEN** the body SHALL contain `a&lt;img&gt;.example` and SHALL NOT contain `<img>`

#### Scenario: HTML page does not enumerate admitted hosts
- **WHEN** `enforce` mode, a live tunnel origin is `https://abc.share.zrok.io`, `allowedHosts` contains `dash.home.arpa`, and `GET /` arrives with a refused Host and `Accept: text/html`
- **THEN** the body SHALL contain neither `abc.share.zrok.io` nor `dash.home.arpa`

#### Scenario: fetch caller gets the JSON refusal
- **WHEN** `enforce` mode and `GET /api/health` arrives with `Host: rebind.example` and `Accept: application/json`
- **THEN** the response SHALL be `403` JSON with `error: "host_not_allowed"`

### Requirement: Refusals are logged
Every non-admissible Host, in either mode, SHALL produce one server log line that identifies the mode outcome (`refused` or `would-refuse`), the Host, the Origin (or its absence), and for HTTP the method and URL, for WebSocket the route scope. Header values SHALL be sanitised for logging (control characters removed, length bounded). Repeated refusals for the same hostname SHALL be rate-limited, and total refusal lines per minute across all hostnames SHALL be capped at 60 with one summary line stating the suppressed count, so a scanning page cannot flood the log; the rate-limiter's per-hostname state SHALL be bounded to 256 hostnames.

#### Scenario: Report-only refusal is distinguishable
- **WHEN** the gate is in `report` mode and refuses `Host: rebind.example`
- **THEN** the log line SHALL contain `[host-gate] would-refuse` and `host=rebind.example`

#### Scenario: Enforced refusal is logged
- **WHEN** the gate is in `enforce` mode and refuses a `/ws` upgrade with `Host: rebind.example`
- **THEN** the log line SHALL contain `[host-gate] refused`, `host=rebind.example`, and `scope=browser`

#### Scenario: Log values are sanitised
- **WHEN** a request arrives with a `Host` header containing a newline followed by a forged log line
- **THEN** the log line SHALL contain neither the newline nor the forged text

#### Scenario: Repeated refusals are rate-limited
- **WHEN** one hundred requests with `Host: rebind.example` arrive within one minute
- **THEN** the log SHALL contain at most one `[host-gate]` line for `rebind.example` in that minute

#### Scenario: Distinct-hostname scan is capped
- **WHEN** ten thousand requests with distinct Hosts `a<n>.rebind.example` arrive within one minute
- **THEN** the log SHALL contain no more than 60 `[host-gate]` refusal lines plus one `suppressed` summary line

#### Scenario: Unrecognised env value is logged at boot
- **WHEN** the server starts with `PI_DASHBOARD_HOST_GATE=reports`
- **THEN** the log SHALL contain one line naming `PI_DASHBOARD_HOST_GATE` and the ignored value

### Requirement: Host-gate state is readable by the operator
The dashboard SHALL expose `GET /api/host-gate` returning `{ success: true, mode, envOverridden, admitted: [{ host, source }], recent: [{ host, count, lastSeen, outcome }] }`. `mode` is the resolved mode and `envOverridden` is `true` when `PI_DASHBOARD_HOST_GATE` holds a recognised value. `admitted` is derived server-side from the same inputs as the admission decision, one row per hostname with its first-matching source from `loopback`, `ip-address`, `bind-address`, `local`, `public-base-url`, `cors-origin`, `live-tunnel`, `allowed-host`; `loopback`, `ip-address` and `local` are pattern rows (`localhost` / `127.0.0.1` / `::1`, `any IP address`, `*.local`), not enumerations. `recent` holds the most recent distinct non-admissible hostnames since server start (bounded to 50 entries, least-recently-seen evicted, most recent first); `host` is the parsed hostname (port stripped, same normalisation as the decision; malformed or absent Hosts share the key `(malformed)`), `count` is the number of refusals for that hostname — every refusal counts, independent of the log rate limit — and `outcome` is `refused` or `would-refuse` per the mode at the time of the last refusal. The endpoint SHALL be subject to the same authentication as `GET /api/config`.

#### Scenario: Refusals appear with counts
- **WHEN** three requests with `Host: rebind.example:8000` and one with `Host: proxy-int.corp` have been refused in report mode within one second
- **THEN** `GET /api/host-gate` SHALL return `recent` with `rebind.example` (no port) `count: 3` and `proxy-int.corp` `count: 1`, both `outcome: "would-refuse"`

#### Scenario: Admitted list is derived and pattern rows are not enumerated
- **WHEN** `publicBaseUrls` contains `https://pi.example.com`, `allowedHosts` contains `dash.home.arpa`, and a live tunnel origin is `https://abc.share.zrok.io`
- **THEN** `admitted` SHALL contain `{ host: "pi.example.com", source: "public-base-url" }`, `{ host: "dash.home.arpa", source: "allowed-host" }`, `{ host: "abc.share.zrok.io", source: "live-tunnel" }`, one `local` pattern row and one `ip-address` pattern row

#### Scenario: Env override is reported
- **WHEN** `PI_DASHBOARD_HOST_GATE=report` is set and `hostGate.mode` is `enforce`
- **THEN** the response SHALL carry `mode: "report"` and `envOverridden: true`

#### Scenario: Admitting a host removes it from later refusals
- **WHEN** `rebind.example` is appended to `allowedHosts` and a new request with that Host arrives
- **THEN** its entry's `count` SHALL NOT increase

#### Scenario: Empty ring
- **WHEN** no request has been refused since start
- **THEN** `recent` SHALL be `[]`
