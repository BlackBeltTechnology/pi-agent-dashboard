## MODIFIED Requirements

### Requirement: Admissible hostnames are derived from what the dashboard already answers on
A hostname SHALL be admissible when any of the following holds, each evaluated against current (not boot-time) state: it is a loopback literal (`localhost`, `127.0.0.1`, `::1`), any IPv4 or IPv6 literal (`net.isIP` — strict forms; shorthand such as `127.1` is not an IP literal), or the address the listener was bound to; it is `<label>.local` with a non-empty label; it is the hostname of an entry in `publicBaseUrls` (including entries inherited from the legacy `pairing.publicBaseUrls` key); it is the hostname of an entry in `cors.allowedOrigins`; it is the hostname of a currently live tunnel origin; it is the exact name of a certificate the optional TLS listener currently serves while that listener is enabled and bound (wildcard certificates are not admitted); or it appears in the top-level `allowedHosts` config field. The set SHALL NOT be a separate copied list: a hostname admitted through `publicBaseUrls`, `cors.allowedOrigins`, a live tunnel, or a TLS-listener certificate SHALL NOT need to be duplicated into `allowedHosts`, and removing the source entry SHALL remove the admission. A source entry that does not parse as a URL SHALL be skipped, not raise.

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

#### Scenario: TLS-listener certificate name is admitted
- **WHEN** the TLS listener holds a certificate for `host.example.ts.net` and a request arrives with `Host: host.example.ts.net:8443`
- **THEN** the request SHALL be admitted, on either listener, because matching is on the hostname alone
- **AND** after the certificate is pruned, or the listener is disabled, the next request with that `Host` SHALL no longer be admitted, with no restart

#### Scenario: Wildcard certificate does not admit subdomains
- **WHEN** the TLS listener serves only `*.example.com` and a request arrives with `Host: dash.example.com`
- **THEN** the request SHALL NOT be admitted unless `dash.example.com` is admitted by another source

### Requirement: Host-gate state is readable by the operator
The dashboard SHALL expose `GET /api/host-gate` returning `{ success: true, mode, envOverridden, admitted: [{ host, source }], recent: [{ host, count, lastSeen, outcome }] }`. `mode` is the resolved mode and `envOverridden` is `true` when `PI_DASHBOARD_HOST_GATE` holds a recognised value. `admitted` is derived server-side from the same inputs as the admission decision, one row per hostname with its first-matching source from `loopback`, `ip-address`, `bind-address`, `local`, `public-base-url`, `cors-origin`, `live-tunnel`, `tls-listener`, `allowed-host`; `loopback`, `ip-address` and `local` are pattern rows (`localhost` / `127.0.0.1` / `::1`, `any IP address`, `*.local`), not enumerations. `recent` holds the most recent distinct non-admissible hostnames since server start (bounded to 50 entries, least-recently-seen evicted, most recent first); `host` is the parsed hostname (port stripped, same normalisation as the decision; malformed or absent Hosts share the key `(malformed)`), `count` is the number of refusals for that hostname — every refusal counts, independent of the log rate limit — and `outcome` is `refused` or `would-refuse` per the mode at the time of the last refusal. The endpoint SHALL be subject to the same authentication as `GET /api/config`.

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
