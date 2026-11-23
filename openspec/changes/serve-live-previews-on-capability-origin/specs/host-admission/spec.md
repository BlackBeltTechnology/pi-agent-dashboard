## MODIFIED Requirements

### Requirement: Every request is checked against an admissible-hostname set
The dashboard listener SHALL evaluate the `Host` header of every HTTP request and every WebSocket upgrade — including requests that carry no `Origin` header — against a set of admissible hostnames. The check SHALL run before CORS headers are produced and before any `Origin`-based admission, on every path, regardless of whether OAuth is configured, in addition to (never instead of) the existing authentication and network admission. Matching SHALL be on the hostname alone (port stripped, IPv6 brackets stripped, trailing dot stripped, case-insensitive); the port SHALL NOT participate in the decision. A request with no `Host` header, or a `Host` header that does not parse as a hostname or IP literal, SHALL be treated as not admissible. A preview-shaped `Host` (live-server-preview) SHALL be checked by the preview dispatcher's exact live-host admission instead of this static set.

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

#### Scenario: Preview-shaped Host is decided by the preview dispatcher
- **WHEN** a capability with the 26-character label `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live and requests arrive with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000` and with `Host: <other-26-char-label>.localhost:8000` for a label no capability holds
- **THEN** the first SHALL be admitted by the preview dispatcher and the second SHALL be refused by it, neither being evaluated against the static hostname set

### Requirement: Host-gate state is readable by the operator
The dashboard SHALL expose `GET /api/host-gate` returning `{ success: true, mode, envOverridden, admitted: [{ host, source }], recent: [{ host, count, lastSeen, outcome }] }`. `mode` is the resolved mode and `envOverridden` is `true` when `PI_DASHBOARD_HOST_GATE` holds a recognised value. `admitted` is derived server-side from the same inputs as the admission decision, one row per hostname with its first-matching source from `loopback`, `ip-address`, `bind-address`, `local`, `public-base-url`, `cors-origin`, `live-tunnel`, `tls-listener`, `allowed-host`, `live-preview`; `loopback`, `ip-address`, `local` and `live-preview` are pattern rows (`localhost` / `127.0.0.1` / `::1`, `any IP address`, `*.local`, `live preview capability hosts`), not enumerations; the `live-preview` row describes the preview dispatcher's dynamic admission, not a member of the static set, and SHALL never enumerate capability labels or origins. The `live-preview` row SHALL be present whenever `liveServer.previewOrigins.enabled` is true, even with zero live capabilities, and absent when it is `false`. `recent` holds the most recent distinct non-admissible hostnames since server start (preview-shaped refusals, which are answered by the preview dispatcher, SHALL NOT appear in it) (bounded to 50 entries, least-recently-seen evicted, most recent first); `host` is the parsed hostname (port stripped, same normalisation as the decision; malformed or absent Hosts share the key `(malformed)`), `count` is the number of refusals for that hostname — every refusal counts, independent of the log rate limit — and `outcome` is `refused` or `would-refuse` per the mode at the time of the last refusal. The endpoint SHALL be subject to the same authentication as `GET /api/config`.

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

#### Scenario: TLS-listener names are listed with their source
- **WHEN** the TLS listener holds a certificate for `host.example.ts.net`
- **THEN** `admitted` SHALL contain `{ host: "host.example.ts.net", source: "tls-listener" }`

#### Scenario: Live preview source is a pattern row
- **WHEN** `liveServer.previewOrigins.enabled` is true, whether zero or several capabilities are live
- **THEN** `admitted` SHALL contain exactly one `{ host: "live preview capability hosts", source: "live-preview" }` pattern row and SHALL contain no capability label or origin
- **WHEN** `liveServer.previewOrigins.enabled` is `false`
- **THEN** `admitted` SHALL contain no `live-preview` row

#### Scenario: Preview refusals do not appear in recent
- **WHEN** a request arrives with `Host: <unknown-26-char-label>.localhost:8000` and is refused by the preview dispatcher
- **THEN** `recent` SHALL NOT contain that hostname

### Requirement: Enforcement mode is switchable and defaults to enforce
The gate SHALL run in one of two modes, `report` or `enforce`, resolved in this order: the `PI_DASHBOARD_HOST_GATE` environment variable when it holds a recognised value (an unrecognised value contributes nothing and SHALL be logged once at boot); else the `hostGate.mode` config value read live; else `enforce`. In `report` a non-admissible Host is logged and the request proceeds; in `enforce` it is refused. A preview-shaped `Host` (label-shaped, per live-server-preview) with no live capability SHALL be answered by the preview dispatcher with `403` in both modes; a live one is admitted only by that dispatcher (never by the static set); report mode affects only the static gate. A refused HTTP request SHALL receive `403` and no CORS headers; when the request's `Accept` header's first media type is `text/html` (absent `Accept`, `*/*`, or `application/json, text/html;q=0.9` select JSON) the body SHALL be a static HTML page that names the received `Host` (HTML-escaped), names `http://localhost:<port>` as the way in, and names `allowedHosts` and `publicBaseUrls` as the two ways to admit the name; it SHALL NOT enumerate admitted hostnames, tunnel origins, or bind addresses (the refused page is same-origin-readable by a rebinding page) and SHALL reference no script or asset served by the dashboard; otherwise the body SHALL be JSON `{ success: false, error: "host_not_allowed", reason: <human-readable>, hint: <names the config keys that would admit the host> }`. A refused WebSocket upgrade SHALL receive `HTTP/1.1 403` and the socket SHALL be destroyed. The server SHALL log the resolved mode and its source (`env`, `config`, or `default`) once at boot.

#### Scenario: Enforce default refuses a non-admissible Host
- **WHEN** `PI_DASHBOARD_HOST_GATE` is unset, `hostGate.mode` is absent, and a request arrives with a non-admissible `Host`
- **THEN** the request SHALL be refused with `403` and one refusal line SHALL be logged

#### Scenario: Enforce default still admits the loopback and IP-literal population
- **WHEN** `PI_DASHBOARD_HOST_GATE` is unset, `hostGate.mode` is absent, and requests arrive with `Host: localhost:8000`, `Host: 127.0.0.1:8000`, `Host: [::1]:8000`, and `Host: 192.168.1.20:8000`
- **THEN** every request SHALL be served normally

#### Scenario: Report-only opt-out via config
- **WHEN** `hostGate.mode` is `report` and the env var is unset and a request arrives with a non-admissible `Host`
- **THEN** the request SHALL be served normally and one refusal line SHALL be logged

#### Scenario: Enforce mode refuses with a self-describing body
- **WHEN** `PI_DASHBOARD_HOST_GATE=enforce` and `GET /api/health` arrives with `Host: rebind.example`
- **THEN** the response SHALL be `403` with `error: "host_not_allowed"` and a `hint` naming `allowedHosts` and `publicBaseUrls`, and SHALL carry no `Access-Control-Allow-Origin` header

#### Scenario: Unrecognised config mode stays report-only
- **WHEN** `hostGate.mode` holds an unrecognised value and the env var is unset
- **THEN** the gate SHALL behave as `report` and SHALL NOT adopt the `enforce` default (a typo'd config value SHALL NOT lock the operator out)

#### Scenario: Unrecognised env value falls through to config
- **WHEN** `PI_DASHBOARD_HOST_GATE=yes` and `hostGate.mode` is absent
- **THEN** the gate SHALL behave as `enforce`
- **WHEN** `PI_DASHBOARD_HOST_GATE=yes` and `hostGate.mode` is `report`
- **THEN** the gate SHALL behave as `report`

#### Scenario: Config mode applies live and env overrides it
- **WHEN** `hostGate.mode` is changed to `report` in `config.json` while the server runs and the env var is unset
- **THEN** the next non-admissible request SHALL be served with no restart
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

#### Scenario: Boot log names the resolved mode
- **WHEN** the server starts with neither env var nor config mode set
- **THEN** one boot log line SHALL state the host gate is `enforce` from `default`

#### Scenario: Preview-shaped Host is refused in report mode
- **WHEN** `hostGate.mode` is `report` and a request arrives with `Host: <unknown-26-char-label>.localhost:8000` for a label no capability holds
- **THEN** the preview dispatcher SHALL respond `403` (report mode SHALL NOT route it to the dashboard)

#### Scenario: Non-preview-shaped lookalike reaches the static gate
- **WHEN** `enforce` mode and a request arrives with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost.evil.example`
- **THEN** the host is not preview-shaped, so the static gate SHALL refuse it with `403`

#### Scenario: Disabled previews admit no preview host
- **WHEN** `liveServer.previewOrigins.enabled` is `false` and a request arrives with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** the preview dispatcher SHALL respond `403`
- **AND** with `wildcard.suffix` `preview.example.com` or `ipDnsSuffix` `sslip.io` or `portPool` `8100-8199` still validly configured, requests with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.preview.example.com`, `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.192-168-1-5.sslip.io:8000` and `Host: 192.168.1.5:8101` SHALL each stay preview-shaped and be answered `403` by the preview dispatcher, never routed to the dashboard app

#### Scenario: Statically admitted name under localhost is served by the dashboard
- **WHEN** `dash.localhost` is admitted by a static source and a request arrives with `Host: dash.localhost:8000`
- **THEN** the dashboard SHALL serve it (the host is not preview-shaped)

## ADDED Requirements

### Requirement: Live preview capability hosts are admitted exactly and dynamically
A preview-shaped `Host` SHALL be admitted only when its exact capability label is registered and unexpired, evaluated against current state, and SHALL reach only the preview namespace (dispatched before dashboard routing; `/api`, `/ws`, `/auth`, the SPA shell, and plugin routes unreachable). Admission SHALL be exact: no wildcard, bare-suffix, parent-domain, or extra-label admission, and no preview host added to any static source. Each decision SHALL be logged with the label redacted.

#### Scenario: Live tier-1 capability host is admitted
- **WHEN** a capability with label `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live and a request arrives with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** the request SHALL be admitted and handled by the preview namespace

#### Scenario: Unknown subdomain is refused
- **WHEN** a request arrives with `Host: <unknown-26-char-label>.localhost:8000` and no live capability holds that label
- **THEN** the preview dispatcher SHALL respond `403` with `error: "host_not_allowed"` and no remedy keys (`hint`, `reason` naming config keys), SHALL NOT add the host to the host-gate `recent` list, and SHALL log the refusal

#### Scenario: Expired capability host is refused
- **WHEN** the capability with label `a2b3c4d5e6f7g2h3i4j5k6l7m2` has expired or been revoked and a request arrives with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** the preview dispatcher SHALL respond `403`, with no restart needed after expiry

#### Scenario: Wildcard-domain capability host is admitted only for live labels
- **WHEN** `liveServer.previewOrigins.wildcard.suffix` is `preview.example.com`, a capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live, and requests arrive with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.preview.example.com` and `Host: <other-26-char-label>.preview.example.com`
- **THEN** the first SHALL be admitted and the second SHALL be refused with `403`

#### Scenario: Wildcard domain itself is not admitted
- **WHEN** `liveServer.previewOrigins.wildcard.suffix` is `preview.example.com`, a capability is live, and a request arrives with `Host: preview.example.com`
- **THEN** the request SHALL NOT be admitted by this rule and SHALL be refused unless another source admits it

#### Scenario: IP-DNS-suffix capability host is admitted
- **WHEN** `liveServer.previewOrigins.ipDnsSuffix` is `sslip.io`, a capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live, and a request arrives with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.192-168-1-5.sslip.io:8000`
- **THEN** the request SHALL be admitted

#### Scenario: Pool listener origin is admitted only while open
- **WHEN** a port-pool listener is open for a live capability at `192.168.1.5:8101`
- **THEN** requests with `Host: 192.168.1.5:8101` SHALL be dispatched to that capability only, and any other Host on that listener SHALL get `403`
- **AND** after the capability expires and the listener closes, connections to `192.168.1.5:8101` SHALL be refused by the operating system

#### Scenario: Extra labels around a capability host are not admitted
- **WHEN** enforcement is on, a capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live, and requests arrive with `Host: x.a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000` and `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost.evil.example`
- **THEN** each SHALL be refused with `403`

#### Scenario: Wildcard is never admitted
- **WHEN** previews are enabled, enforcement is on, and requests arrive with `Host: anything.localhost:8000` and `Host: zzzzzzzzzzzzzzzzzzzzzzzzzz.localhost:8000` (label-shaped, no live capability)
- **THEN** the server SHALL respond `403` to each (the host gate SHALL NOT behave as if `*.localhost` were admitted) and no preview host SHALL be added to `allowedHosts`, `publicBaseUrls`, or `cors.allowedOrigins`

#### Scenario: Admitted preview host never reaches the dashboard
- **WHEN** a capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live and requests `GET /api/health`, `GET /`, and a WebSocket upgrade for `/ws` arrive with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** none SHALL be served by a dashboard route; each SHALL be forwarded to the capability's upstream (or answered from its static root)

#### Scenario: Preview-host decisions are logged redacted
- **WHEN** a preview host is admitted or refused
- **THEN** the log line SHALL identify the tier and outcome and SHALL contain the capability label only in redacted form
