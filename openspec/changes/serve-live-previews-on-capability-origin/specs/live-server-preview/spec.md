## ADDED Requirements

### Requirement: The preview origin SHALL be selected per mint from the minting request's Host

The capability mint SHALL choose the preview origin from the raw `Host` header and the socket peer of the minting request (no `trustProxy`). Tiers SHALL be evaluated in order, first match wins: 1 loopback, 2 wildcard domain, 3 IP port pool, 4 IP wildcard DNS, 5 base path. Hostnames SHALL be compared after `parseHostname` (lower-case, trailing dot and brackets stripped) with default-port elision.

#### Scenario: Tier 3 wins over tier 4
- **GIVEN** both `portPool` `8100-8199` and `ipDnsSuffix` `sslip.io` are configured and the dashboard is reached as `http://192.168.1.5:8000` by a login-session principal
- **WHEN** a client mints a capability
- **THEN** the response carries `tier: 3`

#### Scenario: Tunnel host falls back to the base path
- **GIVEN** the dashboard is reached as `https://dash.share.zrok.io` and no wildcard domain matches
- **WHEN** a client mints a capability for port target `vite-5173`
- **THEN** the response carries `tier: 5` and `path: "/preview/<pid>/"` with no `origin`

#### Scenario: Hostname comparison is canonical
- **GIVEN** `wildcard.forHosts` is `["dash.example.com"]`
- **WHEN** a client that reached the dashboard as `https://DASH.Example.com.` mints a capability
- **THEN** the `Host` matches the `forHosts` entry and the response carries `tier: 2`

#### Scenario: Same-host proxy adding forwarding headers is not local
- **GIVEN** a reverse proxy on the same machine forwards `Host: localhost:8000` and adds `X-Forwarded-For`
- **WHEN** the proxied client mints a capability
- **THEN** the peer SHALL NOT be genuinely local and tier 1 SHALL NOT be selected
- **AND** the mint log line records `reason=forwarding-headers`

### Requirement: Tier 1 SHALL give a loopback capability origin to a genuinely local browser

Tier 1 SHALL match when the `Host` hostname is `localhost` or `127.0.0.1` (after `parseHostname`), the peer is genuinely local (`isGenuinelyLocal`) and the socket is not TLS. The origin SHALL be `http://<capHost>.localhost:<port>/`, where `<port>` is the `Host` port, or the accepting socket's port when `Host` has none (omitted when it is the scheme default). The tier SHALL be on by default. Locality decides reachability only; authorization stays with the principal.

#### Scenario: Local operator on localhost gets a loopback capability origin
- **GIVEN** a browser on this machine that reached the dashboard as `http://localhost:8000`
- **WHEN** it mints a capability for target `vite-5173` with `accept: ["origin","preview"]`
- **THEN** the response carries `tier: 1` and `origin: "http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000"` (26-character label) and `path: "/"`
- **AND** a request to `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/` is proxied to the upstream

#### Scenario: Loopback Host with a non-local peer does not get tier 1
- **GIVEN** a request whose `Host` is `localhost:8000` but whose peer is not genuinely local (a port-forwarding proxy)
- **WHEN** it mints a capability
- **THEN** tier 1 SHALL NOT be selected
- **AND** the next matching tier applies, which for an unconfigured server is tier 5
- **AND** the mint log line records `reason=non-local-peer`

#### Scenario: IPv6 literal Host or ancestors skips tiers 1-4
- **GIVEN** `portPool` `8100-8199` and `ipDnsSuffix` `sslip.io` are configured
- **WHEN** a genuinely local browser that reached the dashboard as `http://[::1]:8000` mints for port target `vite-5173`, or a login session on `http://[fd00::5]:8000` (a bound address) mints
- **THEN** the response carries `tier: 5` with `path: "/preview/<pid>/"` and no `origin`, and no pool listener is opened
- **AND** a mint on `Host: localhost:8000` whose `Origin` is `http://[::1]:8000` (an IPv6 `ancestors` host) also skips tiers 1-4

#### Scenario: Loopback Host on a TLS socket is not tier 1
- **GIVEN** a genuinely local browser that reached the dashboard over its TLS listener as `https://localhost:8443`
- **WHEN** it mints a capability
- **THEN** tier 1 SHALL NOT be selected and the next matching tier applies

#### Scenario: Host without a port uses the socket port
- **GIVEN** a genuinely local request with `Host: localhost` accepted on port 8000
- **WHEN** it mints a capability
- **THEN** the origin is `http://<capHost>.localhost:8000`

### Requirement: Tier 2 SHALL give a wildcard-domain origin only for explicitly listed dashboard hosts

Tier 2 SHALL match only when `liveServer.previewOrigins.wildcard` is configured and the `Host` hostname equals an entry of `wildcard.forHosts` (exact, case-insensitive). `forHosts` SHALL have no default and SHALL NOT be derived from `publicBaseUrls`, `allowedHosts` or any other setting. The origin SHALL be `<scheme>://<capHost>.<wildcard.suffix>[:<port>]/`, with `scheme` defaulting to `https` and the port omitted unless `wildcard.port` is set. A `wildcard.port` outside 1-65535 disables tier 2.

#### Scenario: Wildcard domain gives an https origin
- **GIVEN** `liveServer.previewOrigins.wildcard` is `{ suffix: "preview.example.com", forHosts: ["dash.example.com"] }`
- **WHEN** a client that reached the dashboard as `https://dash.example.com` mints a capability
- **THEN** the response carries `tier: 2` and `origin: "https://<capHost>.preview.example.com"`

#### Scenario: Wildcard port is validated and elided at the scheme default
- **GIVEN** `wildcard` is `{ suffix: "preview.example.com", forHosts: ["dash.example.com"] }` and a client on `https://dash.example.com`
- **WHEN** `wildcard.port` is `443`, then `8443`
- **THEN** the origin is `https://<capHost>.preview.example.com`, then `https://<capHost>.preview.example.com:8443`
- **AND** with `wildcard.port` `0`, `65536`, `443.5` or `"443"` tier 2 is disabled with a log line naming `wildcard.port`

#### Scenario: Tier 2 needs an explicit forHosts entry
- **GIVEN** `wildcard.suffix` is `preview.example.com`, `forHosts` is empty or absent, and `publicBaseUrls` contains `https://dash.example.com`
- **WHEN** a client that reached the dashboard as `https://dash.example.com` mints a capability
- **THEN** tier 2 SHALL NOT be selected and the next matching tier applies
- **AND** with `forHosts: ["dash.example.com"]` a client on `https://other.example.com` also does not get tier 2

#### Scenario: Plain-http wildcard under an https dashboard is not tier 2
- **GIVEN** `wildcard.scheme` is `"http"` and the dashboard page is served over https from a `forHosts` host
- **WHEN** a client mints a capability
- **THEN** tier 2 SHALL NOT be selected and the next matching tier applies

### Requirement: Tier 3 SHALL match only login-session principals on a local IP Host

Tier 3 SHALL match when the `Host` hostname is a non-loopback IPv4 literal equal to the bind address (or to a local interface address when bound to a wildcard address), `portPool` is set, the principal is a login session holding a `Path=/` cookie, the principal is below its listener cap, and a pool port is free. The origin SHALL be `http://<ip>:<poolPort>/`. Local, network and device-cookie principals SHALL fall through to tier 4 or 5.

#### Scenario: IP Host with a port pool gives a pool-port origin
- **GIVEN** `liveServer.previewOrigins.portPool` is `8100-8199` and a login session reached the dashboard as `http://192.168.1.5:8000`
- **WHEN** it mints a capability
- **THEN** the response carries `tier: 3`, `origin: "http://192.168.1.5:8100"` (or another free pool port) and `path: "/?k=<secret>"`

#### Scenario: Device-cookie principal does not get tier 3
- **GIVEN** `portPool` `8100-8199` and `ipDnsSuffix` `sslip.io` are configured and a principal authenticated only by a `pi_dash_device` cookie reached the dashboard as `http://192.168.1.5:8000`
- **WHEN** it mints a capability
- **THEN** the response carries `tier: 4` and no pool listener is opened

#### Scenario: Local and network principals do not get tier 3
- **GIVEN** `portPool` is configured and a `local` principal or a `network` principal reached the dashboard as `http://192.168.1.5:8000`
- **WHEN** it mints a capability
- **THEN** tier 3 SHALL NOT be selected and the next matching tier applies

#### Scenario: Host IP that is not a bound address skips tier 3
- **GIVEN** the dashboard is bound to `192.168.1.5` and reached with `Host: 10.0.0.9:8000`
- **WHEN** a login session mints a capability
- **THEN** tier 3 SHALL NOT be selected

#### Scenario: Pool exhaustion falls back
- **GIVEN** `portPool` `8100-8101` with both ports held by live capabilities and `ipDnsSuffix` `sslip.io` configured
- **WHEN** a client reached as `http://192.168.1.5:8000` mints a third capability
- **THEN** the response carries `tier: 4`
- **AND** an exhaustion line is logged

#### Scenario: Pool exhaustion without another tier
- **GIVEN** the pool is exhausted and no IP DNS suffix is configured
- **WHEN** a client mints for a port target
- **THEN** the response carries `tier: 5`

### Requirement: Tier 4 SHALL give an IP wildcard-DNS origin for IPv4 Hosts

Tier 3 SHALL win over tier 4 when both match. Tier 4 SHALL match when the `Host` hostname is a non-loopback IPv4 literal (compared after a `net.isIP`/`URL` round-trip) and `liveServer.previewOrigins.ipDnsSuffix` is set. The origin SHALL be `http://<capHost>.<ip-dashed>.<ipDnsSuffix>:<Host port>/`, where `<ip-dashed>` is the IPv4 with `.` replaced by `-`.

#### Scenario: IP Host with only an IP DNS suffix
- **GIVEN** `ipDnsSuffix` is `sslip.io`, no port pool is configured, and the dashboard is reached as `http://192.168.1.5:8000`
- **WHEN** a client mints a capability
- **THEN** the response carries `tier: 4` and `origin: "http://<capHost>.192-168-1-5.sslip.io:8000"`

### Requirement: Plain-http tiers SHALL require a plain-http minting context

Tiers 3 and 4, and tier 2 when `wildcard.scheme` is `http`, SHALL match only when the minting socket is not TLS and the mint's `ancestors` scheme is `http`; otherwise selection falls through. "Socket is not TLS" SHALL be the raw-socket signal (`request.raw.socket.encrypted` or the accepting listener), never `request.protocol`.

#### Scenario: Https dashboard on an IP Host does not get tier 3 or 4
- **GIVEN** `portPool` and `ipDnsSuffix` are configured and a client reached the dashboard over TLS as `https://192.168.1.5:8443`
- **WHEN** it mints a capability
- **THEN** tiers 3 and 4 SHALL NOT be selected and selection falls through to tier 5

### Requirement: Tier 2 over https SHALL require an https minting context

When tier 2's effective scheme is `https`, tier 2 SHALL match only when the mint's `ancestors` scheme is `https`; otherwise selection falls through, so the mint response never carries the label (the capability secret) to a page loaded over plain http. The test SHALL use `ancestors`, not socket TLS, because a TLS-terminating proxy makes the socket plain.

#### Scenario: Plain-http dashboard page does not get an https tier-2 label
- **GIVEN** `wildcard` is `{ suffix: "preview.example.com", forHosts: ["dash.example.com"] }` with the default scheme
- **WHEN** a client on `http://dash.example.com` mints a capability
- **THEN** tier 2 SHALL NOT be selected and the next matching tier applies

#### Scenario: Mint without Origin takes the ancestors scheme from the raw socket
- **GIVEN** `wildcard` is `{ suffix: "preview.example.com", forHosts: ["dash.example.com"] }`
- **WHEN** a mint without an `Origin` header arrives on a plain-http socket with `Host: dash.example.com` and `X-Forwarded-Proto: https`
- **THEN** the fallback `ancestors` scheme is `http` (from `request.raw.socket.encrypted`, never `X-Forwarded-Proto`), tier 2 SHALL NOT be selected and selection falls through to tier 5
- **AND** the same mint on a TLS socket without `Origin` gets `ancestors` scheme `https` and `tier: 2`

#### Scenario: Https page behind a TLS-terminating proxy gets tier 2
- **GIVEN** the same config and a proxy that terminates TLS and forwards `Host: dash.example.com` over plain http
- **WHEN** a page on `https://dash.example.com` mints a capability
- **THEN** the response carries `tier: 2`

### Requirement: Capability host labels SHALL be random base32 and looked up by hash

`<capHost>` SHALL be 128 random bits encoded as 26 lowercase base32 characters (`[a-z2-7]{26}`), one DNS label. For tiers 1, 2 and 4 the label IS the capability secret: the store SHALL be looked up by hash, hold the label in server memory only, and never persist or log it unredacted. A mint with the same target, minter, policy, tier and ancestors SHALL return the existing capability while its absolute expiry is more than 20 minutes away.

#### Scenario: Re-mint returns the same origin
- **GIVEN** a live tier-1 capability minted for `vite-5173` by principal P, 2 hours before its absolute expiry
- **WHEN** P mints again with the same policy from the same dashboard origin
- **THEN** the response carries the same `origin`

#### Scenario: Re-mint near absolute expiry issues a new origin
- **GIVEN** a tier-1 capability 11 h 45 min after minting
- **WHEN** the viewer mints again
- **THEN** the response carries a different `origin`

#### Scenario: Reuse does not depend on the viewer
- **GIVEN** a live tier-1 capability for `vite-5173` and a new viewer mount that mints with a fresh viewer id
- **WHEN** the mint arrives with the same policy and ancestors
- **THEN** the existing origin is returned

### Requirement: Capabilities are bound to the origin they were minted for

A capability SHALL be admitted only on requests that arrive on the exact origin it was minted for: exact `Host` for tiers 1, 2 and 4, listener port for tier 3, path for tier 5. A capability of one tier SHALL NOT be admitted through another tier's origin. A tier-1 capability SHALL be admitted only from a genuinely local peer, whatever the principal kind.

#### Scenario: Locally minted capability is not usable remotely
- **GIVEN** a tier-1 capability minted from `http://localhost:8000`
- **WHEN** a request through a tunnel presents `Host: k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000`
- **THEN** it SHALL NOT be admitted
- **AND** a capability minted on tier 5 SHALL NOT be admitted at `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/`

#### Scenario: Tier-1 label from a LAN peer with a forged Host
- **GIVEN** a tier-1 capability minted by a login-session principal on this machine
- **WHEN** a LAN peer sends a request with `Host: k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000` and that session's cookie
- **THEN** the response is 403

### Requirement: Preview-origin configuration has a fixed shape

The configuration SHALL be `liveServer.previewOrigins.{enabled, wildcard:{suffix, forHosts, scheme?, port?}, portPool, ipDnsSuffix}`. `enabled` defaults to `true`; `false` selects legacy paths only. `wildcard.scheme` is `https` (default) or `http`. `portPool` is a range string such as `8100-8199`. The `liveServer` parse branch SHALL keep `previewOrigins` independently of `previewExposure`, and the values SHALL be read live.

#### Scenario: Previews disabled by configuration
- **GIVEN** `liveServer.previewOrigins.enabled` is `false`
- **WHEN** a client on `http://localhost:8000` mints a capability
- **THEN** the response carries `tier: "legacy"` and `path: "/live/<id>/~c/<token>/"` and no `origin`
- **AND** a request with `Host: <label>.localhost:8000` is answered 403, never routed to the dashboard app
- **AND** every valid configured wildcard, ipDns and pool host stays preview-shaped and is answered 403 as well

#### Scenario: Live config change revokes entries of a changed tier
- **GIVEN** a live tier-2 entry under `preview.example.com` and a live tier-3 listener on port 8100 under `portPool` `8100-8199`
- **WHEN** `wildcard.suffix` is changed to `preview2.example.com` and `portPool` to `8200-8299` while the server runs
- **THEN** both entries are revoked with log reason `config-changed`, the port-8100 listener is closed (connection refused), and the old label host is answered 403
- **AND** `forHosts` emptied, the suffix removed, a new overlap, or `enabled` set to `false` revokes the tier's entries the same way, while entries of unchanged tiers stay live

#### Scenario: Preview origins are kept without previewExposure
- **GIVEN** `liveServer` sets `previewOrigins` and does not set `previewExposure: "exposed"`
- **WHEN** the configuration is parsed
- **THEN** `previewOrigins` is kept

### Requirement: Invalid preview-origin values SHALL disable only their tier

A value that is malformed, or that overlaps a hostname the dashboard admits, SHALL disable only the affected tier and SHALL be reported at startup and afterwards only when the validation result or the resolved tier set changes (an unrelated config write logs nothing). The conditions checked are the scenarios below. Other tiers SHALL stay available.

#### Scenario: Invalid pool range disables only tier 3
- **GIVEN** `portPool` is `8200-8100`
- **WHEN** the server starts
- **THEN** tier 3 SHALL be disabled and one startup log line SHALL name the key
- **AND** tiers 1, 2, 4 and 5 SHALL remain available

#### Scenario: Pool range grammar is strict
- **WHEN** `portPool` is `8100-8100`
- **THEN** tier 3 is enabled with one port
- **AND** with `8100`, `08100-8199`, ` 8100-8199`, `8100 - 8199`, `8100-8199 `, `1023-1100`, `8100-65536` or `8100-8200` (101 ports) tier 3 is disabled with a log line naming `portPool`, while `8100-8199` (100 ports) and `65435-65534` are accepted

#### Scenario: Pool containing a reserved port is invalid
- **GIVEN** `portPool` is larger than 100 ports, or includes a port below 1024, the dashboard port, `piPort`, the TLS listener port or the model-proxy port (the last two only when those listeners are configured; an unbound listener cannot collide)
- **WHEN** the server starts
- **THEN** tier 3 SHALL be disabled and one log line SHALL name the key

#### Scenario: Suffix that is or ends in localhost is invalid
- **GIVEN** `ipDnsSuffix` or `wildcard.suffix` is `localhost` or ends in `.localhost`
- **WHEN** the server starts
- **THEN** that tier SHALL be disabled with a log line naming the key
- **AND** the test is a label boundary: the normalised suffix `=== "localhost"` or ending with `.localhost` is rejected, while `foolocalhost.dev` and `mylocalhost.dev` are accepted

#### Scenario: Suffix overlap is invalid
- **GIVEN** `wildcard.suffix` equals `ipDnsSuffix` (after normalisation), or a suffix covers a `forHosts`, `publicBaseUrls`, `allowedHosts` or `cors.allowedOrigins` hostname whose leftmost label is 26 base32 characters
- **WHEN** the server starts
- **THEN** the affected tier SHALL be disabled with a log line naming the key
- **AND** when `wildcard.suffix` equals `ipDnsSuffix`, both tier 2 and tier 4 are disabled with exactly one log line naming both keys

#### Scenario: Suffix under `.local` is invalid
- **GIVEN** `wildcard.suffix` is `preview.local`, or `ipDnsSuffix` makes `<26×a>.1-2-3-4.<ipDnsSuffix>` a statically admitted name
- **WHEN** the server starts
- **THEN** that tier SHALL be disabled with a log line naming the key, because such labels are never preview-shaped

#### Scenario: Suffix and forHosts values are normalised or rejected
- **WHEN** `wildcard.suffix` is `Preview.Example.com.` and `forHosts` is `["DASH.example.com."]`
- **THEN** they resolve to `preview.example.com` and `dash.example.com` (lower-cased, one trailing dot stripped)
- **AND** a suffix containing a scheme (`https://x.com`), port (`x.com:8000`), path (`x.com/p`), `*.` prefix (`*.x.com`), empty label (`a..b.com`) or IP literal (`192.168.1.5`) disables its tier with a log line naming the key

#### Scenario: Non-boolean enabled falls back to legacy
- **WHEN** `liveServer.previewOrigins.enabled` is the string `"false"`
- **THEN** it is treated as `false`, mints return `tier: "legacy"`, and one log line names `liveServer.previewOrigins.enabled`

#### Scenario: Validation is not re-logged on an unrelated write
- **GIVEN** `portPool` is invalid and was logged at startup
- **WHEN** an unrelated config key is written twice, then `portPool` is changed to another invalid value
- **THEN** no log line is emitted for the first two writes and one line for the third

#### Scenario: Wildcard without forHosts is invalid
- **GIVEN** `wildcard.suffix` is set and `forHosts` is empty or absent
- **WHEN** the server starts
- **THEN** tier 2 SHALL be disabled

### Requirement: Shared parent domains SHALL warn about cookie tossing

At startup and on every live change of `previewOrigins` or `forHosts`, the server SHALL warn when tier 2 is active (valid suffix, non-empty `forHosts`, `enabled` true) and `wildcard.suffix` shares a parent domain with a `forHosts` entry. The warning SHALL name the cookie-tossing risk and recommend a separate registrable domain.

#### Scenario: Wildcard suffix sharing a parent domain warns about cookie tossing
- **GIVEN** `wildcard.suffix` is `preview.example.com` and `forHosts` contains `dash.example.com`, so both share the parent `example.com` and a preview can set `Domain=example.com` cookies that the dashboard host also receives
- **WHEN** the server starts
- **THEN** a startup warning SHALL name the risk and recommend a separate registrable domain for previews

#### Scenario: Separate registrable domain does not warn
- **GIVEN** `wildcard.suffix` is `example-preview.net` and `forHosts` contains `dash.example.com`
- **WHEN** the server starts
- **THEN** no parent-domain warning SHALL be logged

#### Scenario: No warning when tier 2 is inactive
- **GIVEN** `wildcard.suffix` is `preview.example.com` and `forHosts` contains `dash.example.com`
- **WHEN** `enabled` is `false`, or the suffix is invalid (`https://preview.example.com`), or `forHosts` is empty
- **THEN** no parent-domain warning is logged

#### Scenario: Live config change creating a shared parent warns
- **GIVEN** `wildcard.suffix` is `example-preview.net` and `forHosts` contains `dash.example.com`
- **WHEN** the operator changes `wildcard.suffix` to `preview.example.com` while the server runs
- **THEN** the warning SHALL be logged at reload

### Requirement: Preview origins SHALL serve only the capability namespace

A request on a live preview origin (a tier 1, 2 or 4 host, or a tier-3 pool listener) SHALL be dispatched to the preview proxy before any dashboard routing and answered only from the capability's target. Dashboard `/api/*`, `/ws`, `/auth/*`, plugin routes and the SPA shell SHALL NOT be reachable there. Preview origins SHALL NOT enter the CORS allow-lists, the same-origin-by-host check, the trusted-network CORS allowance or the host-admission static allowlist.

#### Scenario: Dashboard API is not reachable on a preview origin
- **GIVEN** a live tier-1 capability for `vite-5173` at `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/` whose upstream returns 404 for `/api/sessions`
- **WHEN** a request with a valid dashboard device cookie sends `GET /api/sessions` to that origin
- **THEN** the response is the upstream's 404
- **AND** it SHALL NOT contain dashboard session data

#### Scenario: Dashboard WebSocket is not reachable on a preview origin
- **WHEN** a WebSocket upgrade to `/ws` arrives on a live preview origin
- **THEN** it SHALL be forwarded to the upstream (the app's HMR socket) and SHALL NOT attach to the dashboard event stream

#### Scenario: Dashboard shell is not served on a preview origin
- **WHEN** `GET /` arrives on `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/`
- **THEN** the body is the upstream's document, not the dashboard SPA

#### Scenario: Unknown subdomain is refused
- **WHEN** a request arrives with `Host: zzzzzzzzzzzzzzzzzzzzzzzzzz.localhost:8000` and no live capability has that label
- **THEN** host admission refuses it with 403
- **AND** the response body names no remedy, token or capability

#### Scenario: Expired capability host is refused
- **GIVEN** a tier-1 capability that has expired
- **WHEN** a request arrives on its host
- **THEN** host admission refuses it with 403

#### Scenario: Preview origin is not a trusted CORS origin
- **WHEN** a request to a dashboard `/api/*` route carries `Origin: http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000`
- **THEN** the response SHALL NOT carry an `Access-Control-Allow-Origin` matching it

### Requirement: Pool listener lifecycle

For tier 3 the server SHALL open one HTTP listener per live capability on a free `portPool` port, bound like the dashboard (`bindHost`), serving only that capability's target for HTTP and WebSocket. The listener SHALL close when the capability expires, is revoked, has its target removed or its minting session ended, and on shutdown. A port that fails to bind SHALL be skipped. Listeners SHALL be capped per principal (8).

#### Scenario: Listener opens on mint and closes on expiry
- **GIVEN** `portPool` `8100-8199` and a tier-3 mint that returned `origin: "http://192.168.1.5:8100"`
- **WHEN** the capability has had no accepted request for 30 minutes
- **THEN** the listener on port 8100 SHALL be closed
- **AND** a connection to `192.168.1.5:8100` SHALL be refused

#### Scenario: Sweep frees a port with zero traffic
- **GIVEN** a tier-3 capability on port 8100 whose idle expiry has passed and no request ever arrives
- **WHEN** fake timers advance to expiry + 60 s
- **THEN** port 8100 is released and free to re-allocate
- **AND** the 60 s sweep timer is owned by the store, `unref()`'d so it never keeps the process alive, and cleared when the dashboard closes

#### Scenario: Pool listener serves only its target
- **GIVEN** a live listener on port 8100 for target `vite-5173`
- **WHEN** a request for `/api/sessions` arrives on port 8100 with the required credentials
- **THEN** it is forwarded to the `vite-5173` upstream and never reaches a dashboard route

#### Scenario: Ended session frees its pool port
- **GIVEN** a tier-3 capability minted by login session S on port 8100
- **WHEN** session S ends
- **THEN** the listener on port 8100 SHALL be closed

#### Scenario: Per-principal listener cap
- **GIVEN** a login session already holds 8 live pool listeners
- **WHEN** it mints for another target
- **THEN** tier 3 SHALL NOT be selected and the next matching tier applies

### Requirement: Pool listener admission

A pool-port request SHALL be admitted only with the minting session's `pi_dash_token` (another valid session is refused) and the host-only `pi_dash_pool_<port>` cookie set by the one-shot `?k=<secret>`; otherwise 404. A present `Origin` SHALL equal the entry origin (else 404; upgrades 403). A duplicated `pi_dash_token` or `pi_dash_pool_*` cookie counts as missing. A wrong `Host` gets 403. All `pi_dash_*` cookies SHALL be stripped before forwarding.

#### Scenario: Pool port without the minting credential is refused
- **GIVEN** a tier-3 capability minted by a login-session principal on port 8100
- **WHEN** a LAN peer without that session's `pi_dash_token` cookie requests `http://192.168.1.5:8100/`
- **THEN** the response SHALL be 404

#### Scenario: Another valid session is refused
- **GIVEN** a tier-3 capability minted by session S on port 8100
- **WHEN** a request on port 8100 carries a different valid session's `pi_dash_token`
- **THEN** the response SHALL be 404

#### Scenario: First navigation sets the per-capability cookie
- **GIVEN** a tier-3 mint response with `path: "/?k=<secret>"`
- **WHEN** the browser requests `http://192.168.1.5:8100/?k=<secret>&to=%2Fdeep` with the session cookie
- **THEN** the listener answers with a redirect to the same-origin root-relative `to` path and a host-only, `HttpOnly`, `SameSite=Strict` `pi_dash_pool_8100` cookie
- **AND** later requests need both that cookie and the session cookie

#### Scenario: Invalid `to` redirects to the root
- **GIVEN** a tier-3 mint with a valid `k`
- **WHEN** the browser requests `/?k=<secret>&to=` followed by `//evil.example/`, `/a\b`, `/a%0Ab` (control character), a value not starting with `/`, or a 2049-character path
- **THEN** the listener redirects to `/` with the `pi_dash_pool_8100` cookie set, and that `k` is consumed (a repeat of it does not redirect to `to`)
- **AND** `to=%2Fdeep` (valid, at most 2048 characters) redirects to `/deep`

#### Scenario: Page from a second pool port is refused
- **GIVEN** live tier-3 capabilities on ports 8100 and 8101 for the same session
- **WHEN** a page served from port 8101 requests `http://192.168.1.5:8100/` carrying all cookies and `Origin: http://192.168.1.5:8101`
- **THEN** the response SHALL be 404

#### Scenario: Duplicated session cookie on a pool port
- **GIVEN** a live tier-3 capability on port 8100
- **WHEN** a request carries two `pi_dash_token` cookies
- **THEN** the response SHALL be 404 and nothing is forwarded

#### Scenario: Reopen re-mints and gets a fresh k
- **GIVEN** a live tier-3 capability whose first `k` was consumed
- **WHEN** the same principal mints again
- **THEN** the response carries a fresh `k`, earlier unconsumed `k`s are invalid, and a consumed or unknown `k` with a valid cookie and session redirects to the clean URL, otherwise 404

#### Scenario: Pool credential is not forwarded upstream
- **GIVEN** a live tier-3 capability and a request carrying the session cookie, its `pi_dash_pool_8100` cookie and a second live `pi_dash_pool_8101` cookie
- **WHEN** the request is proxied
- **THEN** the upstream receives no `pi_dash_*` cookie, and in particular no `pi_dash_pool_*` cookie

#### Scenario: Wrong Host on a pool port
- **WHEN** a request on port 8100 carries `Host: 192.168.1.5:8101`
- **THEN** the response is 403

#### Scenario: A live listener is distinguishable from a closed port
- **WHEN** a request without credentials reaches a live pool port, and a connection is attempted to a closed pool port
- **THEN** the live port answers 404 and the closed port refuses the connection

### Requirement: Tier-5 path shape and forwarding

A tier-5 capability SHALL be `/preview/<pid>/` on the dashboard origin, for port targets only, `<pid>` being at least 128 random bits as base64url, looked up by hash, in memory only. The proxy SHALL forward the FULL path upstream and rewrite a root-absolute `Location` into the prefix. A request without a live `<pid>`, or whose raw pathname has a dot-segment, `%2F %7E %2E %5C` (any hex case), a raw `\` or `%00`, SHALL be 404. Logs SHALL redact `<pid>`. Plain HTTP SHALL work.

#### Scenario: Upstream receives the full base path
- **GIVEN** a live tier-5 capability `/preview/Xk3…q9/` for `vite-5173` started with `--base /preview/Xk3…q9/`
- **WHEN** `GET /preview/Xk3…q9/src/main.ts` is proxied
- **THEN** the upstream SHALL receive `GET /preview/Xk3…q9/src/main.ts`

#### Scenario: Unknown pid is 404
- **WHEN** a browser-originated or non-browser request hits `/preview/AAAAAAAAAAAAAAAAAAAAAA/`
- **THEN** the response is 404

#### Scenario: Encoded traversal after the pid is refused
- **WHEN** a request hits `/preview/<pid>/..%2F..%2Fx`
- **THEN** the response is 404 and nothing is forwarded

#### Scenario: Refused and forwarded raw paths
- **WHEN** requests hit `/preview/<pid>/%2f`, `/preview/<pid>/%7E`, `/preview/<pid>/%2e%2E/x`, `/preview/<pid>/a%5Cb`, `/preview/<pid>/a\b` (raw backslash), `/preview/<pid>/a%00b` and `/preview/<pid>/./x`
- **THEN** each is 404 and nothing is forwarded
- **AND** `/preview/<pid>//x` and `/preview/<pid>/%252e/x` are forwarded upstream exactly as received

#### Scenario: Redirect stays inside the base
- **WHEN** the tier-5 upstream answers `302 Location: /login`
- **THEN** the browser SHALL receive `Location: /preview/<pid>/login`

#### Scenario: Static target on a tier-5 host
- **GIVEN** the dashboard is reached through a tier-5 host
- **WHEN** a capability is minted for a static target
- **THEN** the response carries `tier: "legacy"` and `path: "/live/<id>/~c/<token>/"`

### Requirement: Tier-5 holders and policy

There SHALL be ONE current `<pid>` per target, shared by a holder set of every principal that minted or reserved it. A tier-5 mint SHALL add or refresh its principal as a mint holder and return the same `<pid>`; a request is admitted while one mint holder admits it. Any other principal told the `<pid>` (a reserver, a tier 1-4 `base` recipient) SHALL be a revocation-only holder: it admits nothing and adds no policy. Enforced policy SHALL be the most restrictive across mint holders.

#### Scenario: Re-mint returns the same path
- **GIVEN** a live tier-5 capability for `vite-5173` held only by principal P, minted with `egress: "restricted"`
- **WHEN** P mints again with `egress: "open"`
- **THEN** the response `path` SHALL equal the first one
- **AND** subsequent responses under it SHALL carry the open-policy CSP

#### Scenario: A second principal gets the same path
- **GIVEN** a live tier-5 capability for `vite-5173` held by principal P
- **WHEN** principal Q mints for `vite-5173`
- **THEN** the response `path` SHALL equal P's
- **AND** both P and Q are holders

#### Scenario: Holder Q requesting open egress does not widen P's restricted egress
- **GIVEN** a tier-5 capability for `vite-5173` held by P with `egress: "restricted"`
- **WHEN** Q joins and mints with `egress: "open"`
- **THEN** responses under the `<pid>` SHALL keep the restricted-policy CSP
- **AND** the `<pid>` is unchanged

#### Scenario: Local holder admits only local requests
- **GIVEN** a tier-5 capability held only by a genuinely local principal
- **WHEN** a request through a tunnel presents the `<pid>`
- **THEN** it SHALL NOT be admitted

#### Scenario: Reserver and base recipient are revocation-only holders
- **GIVEN** a `<pid>` adopted from a reservation by bridge session B, minted on tier 5 by P, and returned as `base` to a tier-1 minter L
- **WHEN** the holder set is inspected
- **THEN** P is a mint holder, and B and L are revocation-only holders that admit no request and add no policy

### Requirement: Revoking any tier-5 holder SHALL drop the shared pid

Revoking the device of, or ending the session of, ANY holder of either kind SHALL drop the shared `<pid>` for every holder. This is a named exception to `<pid>` stability and keeps parity with `/live/` tokens: a bearer path cannot tell holders apart per request. The next mint SHALL issue a new `<pid>` and the viewer SHALL show the new base with "restart your server with this base".

#### Scenario: Revoking a holder drops the pid
- **GIVEN** a tier-5 capability held by devices A and B
- **WHEN** device A is revoked
- **THEN** requests under the old `/preview/<pid>/` SHALL return 404 and B's next mint returns a different `<pid>`

#### Scenario: Revocation-only holder's session end drops the pid
- **GIVEN** a live `<pid>` held by mint holder P and by a tier-1 minter L whose mint response carried it as `base`
- **WHEN** L's session ends, or the reserving bridge session unregisters
- **THEN** requests under the old `/preview/<pid>/` SHALL return 404 and P's next mint returns a different `<pid>`

#### Scenario: Ending a holder's session drops the pid
- **GIVEN** a tier-5 capability held by login sessions S1 and S2
- **WHEN** session S1 ends
- **THEN** requests under the old `/preview/<pid>/` SHALL return 404 for S2 as well
- **AND** S2's next mint returns a different `<pid>`

### Requirement: Tier-5 lifetime and bounds

The `<pid>` SHALL be stable while its target is registered and it is unexpired: 30 minutes idle, 12 hours absolute from the first mint; a mint within 20 minutes of expiry issues a new `<pid>`, and the superseded `<pid>` serves until its own expiry. Bounds: 32 pids per principal (counted against its creator or adopter; joining a live pid is always allowed) and 256 total; at a cap a new pid is refused, the mint falls back to legacy and live pids are never evicted.

#### Scenario: Re-mint near absolute expiry issues a new path
- **GIVEN** a tier-5 capability 11 h 45 min after its first mint
- **WHEN** the viewer mints again
- **THEN** the response carries a different `<pid>`

#### Scenario: Superseded pid serves until its own expiry
- **GIVEN** a tier-5 `<pid>` P1 minted at t=0 and a mint at t=11 h 45 min that issued P2
- **WHEN** a request for `/preview/P1/` arrives at t=11 h 50 min, and again at t=12 h 01 min
- **THEN** the first is served and the second is 404
- **AND** every mint after t=11 h 45 min returns P2, never P1, and the response says "restart with the new base"

#### Scenario: Re-mint before the window keeps the path
- **GIVEN** a tier-5 capability 2 h after its first mint
- **WHEN** the viewer mints again
- **THEN** the response carries the same `<pid>`

#### Scenario: Principal at cap joins an existing pid
- **GIVEN** principal Q holds 32 pids it created or adopted, and a live pid for `vite-5173` was created by P
- **WHEN** Q mints for `vite-5173`
- **THEN** Q becomes a holder of the existing `<pid>` and no new pid is created

#### Scenario: At the cap the mint falls back to legacy
- **GIVEN** a principal already holds 32 live pids
- **WHEN** it mints a tier-5 capability for a new target
- **THEN** the response carries `tier: "legacy"` and no live pid is evicted

### Requirement: Reserve-path API

`POST /api/live-server/preview-path` with `{ port }` or `{ targetId }` SHALL reserve the tier-5 `<pid>` for a loopback port before its server starts and return `{ path, expiresAt, tier5Viewers: true }`; with no tier-5 viewer socket it returns `{ path: null, tier5Viewers: false }` and reserves nothing. The caller SHALL hold the `control` tier and the port SHALL pass the SSRF guard. A reservation SHALL NOT add a target or make anything viewable; an unadopted pid answers like an unknown one.

#### Scenario: Reserve before the server starts
- **GIVEN** nothing listens on `127.0.0.1:5299` and the caller holds the `control` tier
- **WHEN** it posts `{ "port": 5299 }` to `/api/live-server/preview-path`
- **THEN** the response is 200 with `path: "/preview/<pid>/"` and an `expiresAt`
- **AND** a later tier-5 mint for port 5299 returns the same path

#### Scenario: tier5Viewers reports tier-5 browsers
- **GIVEN** one connected browser socket that announced preview support (`live_preview_accept`) reached the dashboard through a host that classifies to tier 5
- **WHEN** a caller reserves a path
- **THEN** `tier5Viewers` is `true` and the path is reserved

#### Scenario: Old client on a tier-5 host is not a tier-5 viewer
- **GIVEN** the only browser socket on a tier-5 host never announced preview support
- **WHEN** a caller reserves a path
- **THEN** the response is `{ path: null, tier5Viewers: false }` and nothing is reserved

#### Scenario: No tier-5 viewer returns null and reserves nothing
- **GIVEN** no connected browser socket classifies to tier 5
- **WHEN** a caller posts a valid port
- **THEN** the response is `{ path: null, tier5Viewers: false }` and no reservation is counted against any bound

#### Scenario: Reserve rejects a non-loopback or disallowed port
- **WHEN** the body is `{ "port": 22 }` and port 22 fails the target allowlist
- **THEN** the call is refused with the same status as registering that target and nothing is reserved

#### Scenario: Observe tier cannot reserve
- **WHEN** a request authenticated by an `observe` device credential calls the endpoint
- **THEN** it is refused with 403 `insufficient_scope`

#### Scenario: Reservation is not viewable
- **GIVEN** a reservation for port 5299
- **WHEN** the target picker is listed
- **THEN** no target for port 5299 appears because of the reservation alone
- **AND** a WebSocket upgrade to the reserved `/preview/<pid>/` is answered `HTTP/1.1 403`

### Requirement: Reserve calls SHALL reuse a live pid and apply one tier rule on every transport

A reserve call for a port whose target has a live `<pid>` SHALL return that `/preview/<pid>/` path, create no reservation, and add the caller as a revocation-only holder. The bridge `preview_path_request` SHALL apply the REST `control`-tier rule to the connection's principal (a device-ticket admission takes that device's tier); otherwise it SHALL answer `{ path: null, tier5Viewers: false, error: "insufficient_scope" }`, reserving and disclosing nothing.

#### Scenario: Restart on a port with a live pid keeps its base
- **GIVEN** the target for port 5299 has a live `<pid>` and a tier-5 viewer exists
- **WHEN** a caller reserves port 5299
- **THEN** the response `path` is that `/preview/<pid>/`, no reservation is created, and the caller becomes a revocation-only holder
- **AND** a later tier-5 mint for the target returns the same `<pid>`

#### Scenario: Observe-tier bridge cannot reserve
- **GIVEN** a bridge connection admitted by a device ticket of an `observe` device, and a tier-5 viewer exists
- **WHEN** it sends `preview_path_request` for port 5299
- **THEN** the result is `{ path: null, tier5Viewers: false, error: "insufficient_scope" }`, nothing is reserved, and no `<pid>` is disclosed

### Requirement: Reservations SHALL be releasable

A reservation that resolves after its caller's probe aborted SHALL be released by `preview_path_release {requestId}` from the bridge or `DELETE /api/live-server/preview-path/:pid` (reserver only), and the server drops an unbound released reservation. A reserved, unadopted `<pid>` SHALL answer like an unknown pid: 404, and `HTTP/1.1 403` on an upgrade.

#### Scenario: Released reservation is dropped
- **GIVEN** an unbound reservation whose probe timed out
- **WHEN** the reserver sends `preview_path_release` or `DELETE /api/live-server/preview-path/:pid`
- **THEN** the reservation is dropped and a later tier-5 mint never adopts it

#### Scenario: Only the reserver releases
- **GIVEN** a reservation made by principal P
- **WHEN** principal Q calls `DELETE /api/live-server/preview-path/:pid`
- **THEN** the reservation is kept

### Requirement: Reservation adoption

Any principal passing the tier-5 mint admission for a port target (`control` tier, loopback port, SSRF re-check at adoption) SHALL adopt the newest live reservation for that port and become its first mint holder; `reservedBy` SHALL become a revocation-only holder; older ones are dropped. An existing live `<pid>` for the target wins and the reservation is discarded.

#### Scenario: Existing pid beats a reservation
- **GIVEN** a target with a live `<pid>` and a later reservation for its port
- **WHEN** a holder mints
- **THEN** the response carries the existing `<pid>` and the reservation is discarded

#### Scenario: Adoption at the adopter's cap falls back to legacy
- **GIVEN** a live reservation for port 5299 and an adopter that already holds 32 pids (or 256 pids exist in total)
- **WHEN** that adopter mints a tier-5 capability for port 5299
- **THEN** adoption is refused, the response carries `tier: "legacy"`, no live pid is evicted, and the reservation stays until its normal deadline

#### Scenario: An observe-tier principal never adopts
- **GIVEN** principal P reserved port 5299
- **WHEN** an `observe`-tier principal mints a tier-5 capability for port 5299
- **THEN** the mint is refused before adoption and the reservation is untouched

#### Scenario: Viewer opened late still adopts
- **GIVEN** a reservation for port 5299 by the bridge, and a port target registered for it
- **WHEN** a different principal, the viewer, opens it 15 minutes after `serve_mock_site`
- **THEN** the mint adopts the reserved `<pid>`, because the reservation lives while a target exists

#### Scenario: Adoption re-checks the target
- **GIVEN** a reservation whose port has since become the dashboard's own port or left the allowlist
- **WHEN** a mint tries to adopt it
- **THEN** adoption is refused and no `<pid>` is bound to that port
- **AND** the reservation is dropped immediately, one log line records `pid dropped reason=adoption-refused`, and the mint is refused as it is for any disallowed port target

### Requirement: Reservations SHALL be bounded and short-lived

Unbound reservations SHALL be bounded to 8 per reserving principal (REST `principalKeyOf`, or the bridge connection's registered session) and 64 in total; beyond either a new one is refused and none evicted. A principal's new reservation for a port SHALL replace its earlier unbound one for that port. A reservation's deadline is measured from creation: +10 minutes with no port target, +12 hours while one exists, reverting to +10 minutes when the target is removed.

#### Scenario: Unregistered bridge session is refused
- **WHEN** a bridge connection reserves with a `sessionId` that is not registered on that connection
- **THEN** the call is refused and nothing is reserved

#### Scenario: Per-principal reservation bound
- **GIVEN** a principal that already holds 8 unbound reservations
- **WHEN** it reserves another port
- **THEN** the call returns 429

#### Scenario: Global cap refuses a new reservation
- **GIVEN** 64 unbound reservations across principals
- **WHEN** another principal reserves a port
- **THEN** the call is refused and no existing reservation is evicted

#### Scenario: Same principal re-reserving a port replaces its reservation
- **GIVEN** principal P holds an unbound reservation for port 5299
- **WHEN** P reserves port 5299 again
- **THEN** the earlier reservation is dropped, the new one is returned, and P's count is unchanged

#### Scenario: REST caller at a cap
- **WHEN** a REST caller reserves beyond a cap
- **THEN** the response is 429 with `error: "reservation_limit"`

#### Scenario: Bridge caller at a cap
- **WHEN** a bridge session reserves beyond a cap
- **THEN** `preview_path_result` is `{ path: null, tier5Viewers: true, error: "reservation_limit" }`, the probe's pending answer is rejected with that reason, and the site starts at the root

#### Scenario: Reservation deadline follows its target
- **GIVEN** a reservation created at t=0 and a port target that appears at t=9 min and is removed at t=9.5 min
- **WHEN** t reaches 10 min and the next sweep runs
- **THEN** the reservation is gone
- **AND** with a target present until t=20 min the reservation survives to t=20 min and is dropped at the next sweep (at most 21 min)

#### Scenario: Unbound reservation expires
- **GIVEN** a reservation for a port with no port target
- **WHEN** 10 minutes pass after creation
- **THEN** the reservation is gone

### Requirement: Mint responses SHALL describe the tier and clients SHALL negotiate capabilities

`POST /api/live-server/:id/capability` SHALL return `{ origin?, path, tier: 1|2|3|4|5|"legacy", expiresAt, tokenId, policy, base? }`: tiers 1, 2, 4 carry `origin` and `path: "/"`; tier 3 `origin` and `path: "/?k=<secret>"`; tier 5 `path: "/preview/<pid>/"`, no `origin`; legacy `/live/<id>/~c/<token>/`. Tiers 1-4 MAY carry `base: "/preview/<pid>/"`. Without `accept` (`"origin"`, `"preview"`) of the tier's kind the response SHALL be `"legacy"`.

#### Scenario: Old client keeps legacy capability
- **GIVEN** a client that does not send `accept`
- **WHEN** it mints on `http://localhost:8000`
- **THEN** the response carries `tier: "legacy"` and `path: "/live/vite-5173/~c/<token>/"` with no `origin`

#### Scenario: New client receives the tier origin
- **GIVEN** a client that sends `accept: ["origin","preview"]`
- **WHEN** it mints on `http://localhost:8000`
- **THEN** the response carries `tier: 1`, an `origin`, `path: "/"`, `expiresAt`, `tokenId` and `policy`

#### Scenario: Malformed accept returns legacy
- **WHEN** a client on `http://localhost:8000` mints with `accept` set to the string `"origin"`, `[]`, `["ORIGIN"]` or `["bogus"]`, or to an array whose `"origin"` is the 9th entry
- **THEN** each response is 200 with `tier: "legacy"` and no `origin`
- **AND** `["bogus","origin"]` returns `tier: 1` (unknown tokens ignored, matching case-sensitive, only the first 8 entries read)

#### Scenario: Tier-3 mint carries a fresh one-shot k
- **GIVEN** a tier-3 capability for which an earlier `k` was minted but not consumed
- **WHEN** the principal mints again
- **THEN** the response `path` carries a fresh `k`, the earlier `k` is invalid, and the frame src is `origin + "/?k=<k>&to=" + encodeURIComponent(base + deep)`, `base` being the response `base` or `/`

#### Scenario: Tier-1 viewer of a site started under a base frames the base
- **GIVEN** the target's port has a live tier-5 `<pid>` and a client on `http://localhost:8000` sends `accept: ["origin","preview"]`
- **WHEN** it mints
- **THEN** the response carries `tier: 1` and `base: "/preview/<pid>/"`, and the client frames `origin + base + deep`
- **AND** the minter becomes a revocation-only holder of that `<pid>`

#### Scenario: Client without preview support on a tunnel
- **GIVEN** a client that sends `accept: ["origin"]` through a tier-5 host
- **WHEN** it mints
- **THEN** the response carries `tier: "legacy"`

### Requirement: Clients SHALL validate mint responses before framing

The client SHALL frame `origin + path` for tiers 1-4 and the dashboard base + `path` for tier 5 and legacy, SHALL accept only responses whose shape matches the tier, and SHALL never show a tier 1-4 origin or legacy token path as viewer-chrome text; the tier-5 base strip shows `/preview/<pid>/` (see 'Root-absolute hint'). It SHALL reject an `origin` equal to the dashboard's own origin or to the apiBase origin, comparing `new URL(origin)` through `canonicalOrigin()` rather than as strings.

#### Scenario: Client rejects an origin equal to the dashboard
- **GIVEN** a mint response with `origin: "http://localhost:8000"` while the dashboard runs at `http://localhost:8000`
- **WHEN** the client validates it
- **THEN** it SHALL NOT frame it and SHALL surface an error

#### Scenario: Client rejects an origin that does not canonicalise
- **GIVEN** a mint response whose `origin` is unparseable, `"null"` or opaque
- **WHEN** the client validates it
- **THEN** it SHALL NOT frame it and SHALL surface an error (fail closed)

#### Scenario: Client rejects a response with the wrong shape for its tier
- **WHEN** a tier-5 or legacy response carries `origin` or `base`, or a tier 1-4 `base` is not `/preview/<pid>/` shaped (for example `/other/`)
- **THEN** the client SHALL NOT frame it and SHALL surface an error (fail closed)

#### Scenario: Rejection is terminal until a manual Retry
- **GIVEN** the client rejected a mint response
- **WHEN** 60 seconds pass
- **THEN** the viewer shows "preview response rejected" with a Retry button and has sent no further mint request
- **AND** clicking Retry sends exactly one new mint request

#### Scenario: Client rejects a canonical-equivalent origin
- **GIVEN** a mint response with `origin: "http://LOCALHOST.:8000"` while the dashboard or apiBase origin is `http://localhost:8000`
- **WHEN** the client validates it
- **THEN** it SHALL NOT frame it and SHALL surface an error

### Requirement: Preview tier selection and admission SHALL be observable

The server SHALL log per mint the tier chosen and any skip reason (including `forwarding-headers` and `non-local-peer`), and each admit or refusal of a preview host, pool port or `/preview/<pid>/` request, redacting label, `<pid>` and a `?k=` value as `redactCapability` does (case-insensitively) (pool ports are not secret). No log line, including CSRF and WS-gate rejections, SHALL carry a full `<capHost>`, `<pid>`, token, origin or path. Refusals stay out of the host-gate `recent` list.

#### Scenario: Mint logs the tier
- **WHEN** a client on `http://localhost:8000` mints a tier-1 capability
- **THEN** a log line records `tier=1` for the target and no full capability label, origin, path or URL

#### Scenario: Refusal logs a redacted label
- **WHEN** a request arrives on an expired capability host `k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000`
- **THEN** a refusal log line names only the redacted form `<redacted>.localhost:8000`
- **AND** the full label appears in no log line

#### Scenario: Tier-3 k is redacted in logs
- **WHEN** a tier-3 mint is logged and a request to `/?k=<secret>` is refused
- **THEN** no log line contains the `k` value, the label or the `<pid>`; the query appears as `k=<redacted>`

#### Scenario: Existing gate logs redact a preview Origin
- **WHEN** the CSRF gate or the WebSocket gate rejects a request whose `Origin` is a preview origin
- **THEN** the log line carries the label only in redacted form

#### Scenario: Upper-cased label is redacted
- **WHEN** the CSRF gate or the WebSocket gate rejects a request with `Origin: http://K7Q4ZM2X5C6H3V4D5FJQWYABN7.LOCALHOST.:8000`
- **THEN** the log line carries `<redacted>.LOCALHOST.:8000` and the 26-character label in no letter case

#### Scenario: Preview refusals stay out of the host-gate list
- **WHEN** a probe request on an unknown `*.localhost` label is refused
- **THEN** it is absent from the `recent` list served by `/api/host-gate`

### Requirement: A preview resetting dashboard cookies SHALL be surfaced
On any `duplicate_dashboard_cookie` response the client SHALL blank every open tier-2 and tier-3 live frame and show "a preview reset dashboard cookies; reopen it to continue". It SHALL NOT reopen frames automatically.

#### Scenario: Cookie-tossing preview is blanked and announced
- **GIVEN** two open tier-3 frames, one tier-2 frame and one tier-1 frame
- **WHEN** a dashboard API call returns 400 with `error: "duplicate_dashboard_cookie"`
- **THEN** the tier-2 and tier-3 frames get `src="about:blank"` and the banner "a preview reset dashboard cookies; reopen it to continue" is shown; the tier-1 frame is untouched
- **AND** 60 seconds later no frame has been reopened and no mint request was sent; reopening a frame re-mints

## MODIFIED Requirements

### Requirement: Embedded content SHALL be origin-isolated via sandbox

Proxied live-server content SHALL be served on an origin selected by tier (see "The preview origin SHALL be selected per mint from the minting request's Host"): tiers 1-4 on a distinct preview origin (host or port), tier 5 and the legacy capability path on the dashboard's main origin at a path (e.g. `/preview/<pid>/` or `/live/<id>/`, mirroring `/editor/<id>/`) so it stays reachable over the single-port remote tunnel. The preview SHALL NEVER be given the dashboard's origin. For tiers 1-4 the framed document SHALL have an origin different from the dashboard's, so the viewer MAY embed it with `allow-same-origin`; for tier 5 and the legacy path the viewer SHALL embed it with exactly `sandbox="allow-scripts allow-forms allow-popups allow-downloads"` and SHALL NOT set `allow-same-origin`, so the browser assigns the framed document a unique opaque origin. The `allow-scripts` and `allow-same-origin` tokens SHALL NOT both be present on a frame whose origin could be the dashboard's, that is on tier 5 and legacy frames; the viewer SHALL add `allow-same-origin` only when the framed origin differs from the dashboard's own origin. The sandbox SHALL NOT include `allow-downloads-without-user-activation`. The token sets SHALL be:

- Tiers 1-4, open policy with scripts: `allow-scripts allow-same-origin allow-forms allow-popups allow-downloads`; restricted policy with scripts: `allow-scripts allow-same-origin allow-forms`.
- Tier 5 and legacy: open `allow-scripts allow-forms allow-popups allow-downloads`; restricted `allow-scripts allow-forms` (unchanged).
- Scripts off (any tier): empty.

Note that the browser sandbox
does not restrict downloads to user gestures: with `allow-downloads` present, an embedded
app can also trigger a download without a user gesture. Consequently the embedded app SHALL NOT be able
to read the dashboard's `localStorage`/auth token or make same-origin credentialed calls
to the dashboard APIs. On tiers 1-4 this holds because the preview origin differs from the dashboard origin and dashboard cookies are host-only; on tier 3, where cookies are shared across ports, a request to the dashboard listener whose `Cookie` header carries any `pi_dash_*` cookie name more than once SHALL be refused with 400 (as specified by `cross-site-request-gate`), blocking cookie shadowing from the preview; on a pool listener a repeated `pi_dash_token` or `pi_dash_pool_*` name SHALL count as a missing credential (404, see "Pool listener admission").

The isolation SHALL survive navigation of the frame: the preview forwarder (tiers 1-4) SHALL refuse with 502, or rewrite onto the preview origin, any upstream absolute `Location` or `Refresh` target whose origin is a dashboard-admitted origin; and a dashboard document response requested with `Sec-Fetch-Dest: iframe`, `frame`, `object`, `embed` or `fencedframe` outside an allowlist of dashboard-framed routes (`/live/`, `/preview/`, and editor/raw routes that already set a sandbox CSP) SHALL carry `Content-Security-Policy: sandbox` without `allow-same-origin`, so a preview that navigates its frame to the dashboard origin lands in an opaque document. Because Fetch Metadata is not sent to plain-http dashboards, the SPA SHALL NOT render when it runs inside a live frame or under a cross-origin parent (at any nesting depth), and the viewer SHALL blank a live frame whose `contentWindow.location.href` becomes readable.

#### Scenario: Embedded app cannot access the dashboard origin
- **GIVEN** a malicious page served by the previewed dev server that reads
  `window.localStorage` and calls `/api/restart`
- **WHEN** it runs inside the live-server iframe on tier 5 (opaque origin) or on tier 1 at `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/`
- **THEN** it cannot read the dashboard's `localStorage` (opaque origin on tier 5; the separate origin's own storage on tier 1)
- **AND** its calls to dashboard APIs are not authenticated with the dashboard session

#### Scenario: Sandbox does not self-disable
- **WHEN** the live-server iframe is rendered on tier 5 or the legacy path under the open policy with scripts
- **THEN** its `sandbox` token set is exactly `allow-scripts`, `allow-forms`, `allow-popups`, `allow-downloads`
- **AND** its `sandbox` attribute does NOT include `allow-same-origin`

#### Scenario: Distinct-origin tiers add allow-same-origin
- **WHEN** the live-server iframe is rendered at `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/` under the open policy with scripts
- **THEN** its `sandbox` token set is exactly `allow-scripts`, `allow-same-origin`, `allow-forms`, `allow-popups`, `allow-downloads`

#### Scenario: Preview never receives the dashboard origin
- **GIVEN** a tier-1 to tier-4 mint response whose `origin` equals the dashboard's own origin
- **WHEN** the viewer validates it
- **THEN** it SHALL NOT frame it with `allow-same-origin`

#### Scenario: Upstream redirect to the dashboard origin is not followed
- **GIVEN** a tier-1 capability whose upstream answers `302 Location: http://localhost:8000/x`
- **WHEN** the forwarder proxies the response
- **THEN** the browser SHALL NOT receive that `Location` unchanged
- **AND** the response is a 502 or a `Location` on the preview origin

#### Scenario: Dashboard document framed outside the allowlist is sandboxed
- **GIVEN** a preview frame navigated to a dashboard document route outside the allowlist
- **WHEN** the dashboard serves it with `Sec-Fetch-Dest: iframe`, `object` or `embed`
- **THEN** the response carries `Content-Security-Policy: sandbox` without `allow-same-origin`

#### Scenario: Http dashboard without Fetch Metadata blanks a navigated frame
- **GIVEN** a dashboard on plain http, where no `Sec-Fetch-*` header is sent, and a live frame the preview navigated to the dashboard origin
- **WHEN** the frame loads
- **THEN** the SPA renders nothing inside it, and the viewer sets `src="about:blank"` and shows "preview navigated to the dashboard; blocked"

#### Scenario: Dashboard nested inside a preview is not rendered
- **GIVEN** a plain-http dashboard and a tier 1-4 preview document that creates `<iframe src="http://<dashboard>/">`
- **WHEN** the nested dashboard document loads (its `frameElement` is `null` because its parent is cross-origin)
- **THEN** the SPA renders nothing inside it

#### Scenario: Upstream Refresh to the dashboard origin is dropped
- **GIVEN** an upstream response with `Refresh: 0; url=http://localhost:8000/x`
- **WHEN** the forwarder proxies it
- **THEN** the `Refresh` header is dropped

#### Scenario: Tier 3 cookie shadowing is refused
- **GIVEN** a tier-3 preview at `http://192.168.1.5:8100/` that sets a cookie named `pi_dash_token` for the shared host
- **WHEN** the browser then sends a request carrying `pi_dash_token` twice to the dashboard
- **THEN** the dashboard SHALL refuse it with 400 and log the refusal

#### Scenario: User-initiated export from an embedded app reaches the user
- **GIVEN** a loopback app viewed in the live-server pane whose button triggers a file download (e.g. a blob `<a download>` click)
- **WHEN** the user clicks that button inside the frame
- **THEN** the browser performs the download rather than dropping it silently

#### Scenario: Restricted target has no popups or downloads
- **WHEN** a target is framed under the restricted policy with scripts
- **THEN** on tier 5 or legacy its `sandbox` token set is exactly `allow-scripts`, `allow-forms`
- **AND** on tiers 1-4 it is exactly `allow-scripts`, `allow-same-origin`, `allow-forms`

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

The dashboard CORS policy SHALL NOT allow requests whose `Origin` header is `null` on any dashboard route (`/api/*`, `/ws`, `/auth/*` and plugin routes), so a sandboxed opaque-origin document cannot call dashboard APIs cross-origin. This is additive to the existing localhost and live-tunnel-origin allowances. The sole exception SHALL be a valid tier-5 preview response: a response served under a live `/preview/<pid>/` path SHALL carry `Access-Control-Allow-Origin: null` and `Vary: Origin` and SHALL NOT carry `Access-Control-Allow-Credentials`, so an opaque-origin document can load its own module scripts and fetch from its own base. A preflight (`OPTIONS` with `Origin: null`) under a live `<pid>` SHALL be answered 204 with the same headers. The proxy SHALL overwrite any upstream `Access-Control-Allow-Origin` or `Access-Control-Allow-Credentials` on `/preview/` responses carrying `Origin: null`. That header SHALL NOT be added to any dashboard route, to a request without a live `<pid>`, or on tiers 1-4 and the legacy path.

#### Scenario: null-origin API call rejected
- **WHEN** a request arrives at a dashboard `/api/*` route with `Origin: null`
- **THEN** the server SHALL NOT return an `Access-Control-Allow-Origin` matching `null`
- **AND** the cross-origin call SHALL be rejected

#### Scenario: Tier-5 preview response answers null without credentials
- **GIVEN** a live tier-5 capability `/preview/<pid>/`
- **WHEN** `GET /preview/<pid>/src/main.ts` arrives with `Origin: null`
- **THEN** the response carries `Access-Control-Allow-Origin: null` and `Vary: Origin`
- **AND** it SHALL NOT carry `Access-Control-Allow-Credentials`
- **AND** an upstream `Access-Control-Allow-Origin: *` or `Access-Control-Allow-Credentials: true` is overwritten or removed

#### Scenario: Tier-5 preflight answers null without credentials
- **GIVEN** a live tier-5 capability `/preview/<pid>/`
- **WHEN** `OPTIONS /preview/<pid>/src/main.ts` arrives with `Origin: null`
- **THEN** the response is 204 with `Access-Control-Allow-Origin: null` and no `Access-Control-Allow-Credentials`

#### Scenario: Unknown pid preflight gets no CORS header
- **WHEN** `OPTIONS /preview/AAAAAAAAAAAAAAAAAAAAAA/x.js` arrives with `Origin: null`
- **THEN** the response carries no CORS headers

#### Scenario: Null ACAO never on dashboard routes
- **WHEN** `GET /api/sessions` arrives with `Origin: null` while a tier-5 capability is live
- **THEN** the response SHALL NOT carry `Access-Control-Allow-Origin: null`

#### Scenario: Unknown pid gets no CORS header
- **WHEN** `GET /preview/AAAAAAAAAAAAAAAAAAAAAA/x.js` arrives with `Origin: null`
- **THEN** the response is 404 without `Access-Control-Allow-Origin`

### Requirement: Previews authenticate through a per-preview capability path
Because the preview frame may have an opaque origin (tier 5, legacy), or a separate origin with no dashboard cookie (tiers 1, 2, 4), its subresource, fetch and WebSocket requests do not reliably carry a dashboard cookie. The server SHALL therefore offer an **origin-bound capability** for each live-server target. The tiered origin forms and their selection are specified in "The preview origin SHALL be selected per mint from the minting request's Host"; the **capability path** `/live/<id>/~c/<token>/` remains for legacy clients and for static targets on tier-5 hosts:

- **Mint.** `POST /api/live-server/:id/capability` SHALL return `{ origin?, path, tier, expiresAt, tokenId, policy, base? }`, the shape and `base` rule of "Mint responses SHALL describe the tier and clients SHALL negotiate capabilities" (legacy form `{ path: "/live/<id>/~c/<token>/", expiresAt, … }` when the tier is `"legacy"`) for a caller that passes the existing admission rules and holds at least the `control` tier; an unknown `id` SHALL return 404. The secret SHALL be at least 128 bits of randomness, looked up by hash, held only in server memory (never persisted or logged unredacted), and bound to that target id, to the origin it was minted for, and to the minting principal (device id, login session, or local caller; for tier 5, to the holder set of that target's single `<pid>`). The secret is the `<capHost>` host label for tiers 1, 2 and 4, for tier 3 the per-capability `pi_dash_pool_<port>` cookie established by the one-shot `k` (together with the minting session), the stable `<pid>` for tier 5, and the path token for the legacy path.
- **Accept.** For tiers 1, 2 and 4 an HTTP request (any method) or `live`-scope WebSocket upgrade whose `Host` equals exactly the capability origin's host (case-insensitive, same port) SHALL be admitted as authenticated, carrying the minting principal's identity and tier; for tier 3 a request on the live pool port that passes 'Pool listener admission'; for tier 5 a request whose raw pathname begins with exactly the segments `preview`, `<pid>` followed by `/`, compared segment by segment on the raw pathname with no dot-segment and no percent-encoded `/`, `~` or `.` anywhere, the same rule as legacy. For the legacy path an HTTP request (any method) or a `live`-scope WebSocket upgrade whose raw pathname begins with exactly the segments `live`, `<id>`, `~c`, `<token>` followed by `/` — compared segment by segment on the raw (not dot-resolved) pathname, with no dot-segment and no percent-encoded `/`, `~` or `.` anywhere in it — and whose token is valid for that same `<id>` SHALL be admitted as authenticated, carrying the minting principal's identity and tier. A capability SHALL authorize nothing else — no other target id, no other origin and no path outside its own namespace. On a legacy WebSocket upgrade the token is read from the same path segment (never a query parameter or subprotocol). When the identity floor requires a principal-bearing credential for the `live` scope, a capability SHALL satisfy it only if it was minted by an identity principal.
- **Lifetime.** A capability SHALL expire after 30 minutes without an accepted request and in any case 12 hours after minting, and SHALL be invalidated when `previewOrigins.enabled` is turned off (a live tier 1-5 entry is revoked immediately), when its target is removed, its minting device is revoked, its minting session ends (for tier 5: any holder's device revoked or session ended), or the server restarts. Each accepted request SHALL extend the idle expiry.
- **Refusal.** A missing, unknown, expired or wrong-target capability SHALL be refused by the normal admission rules (no credential, or the host-admission 403 for an unknown preview host) and SHALL NOT be distinguishable from an unknown capability to the caller.
- **Forwarding.** On the legacy path the proxy SHALL remove the `/~c/<token>` segment from the forwarded path and from a forwarded `Referer` header, and SHALL rewrite upstream redirects into the capability prefix; on tiers 1-4 the proxy SHALL forward the path unchanged and SHALL strip the capability host label from a forwarded `Referer`; on tier 5 it SHALL forward the full `/preview/<pid>/...` path. On tiers 1-5 the proxy SHALL set `Referrer-Policy: no-referrer` on every proxied response, replacing an upstream value (on tiers 1-4 the origin itself is the secret); on the legacy path it SHALL add it only when the response sets none. Server logs SHALL redact the capability secret.

- **Policy.** The mint SHALL accept an egress policy (`open` or `restricted`) and, for static targets, a scripts flag. An absent or invalid egress SHALL mean `restricted`; an absent scripts flag SHALL mean scripts off. The capability SHALL carry the policy, and every response served under it SHALL apply it; no request path, query or header SHALL change it.
- **Static targets.** A capability for a static target SHALL expire after 10 minutes without an accepted request and in any case 2 hours after minting.
- **Local binding.** A capability minted by a genuinely local caller SHALL be accepted only from genuinely local requests.
- **Exposure.** A restricted, scripts-on capability minted while the dashboard was reachable only from this machine SHALL be invalidated when it becomes reachable from elsewhere.

- **Keepalive.** A mounted, visible viewer MAY extend its capability's idle expiry without changing the framed URL.

`expiresAt` SHALL be the capability's absolute expiry. The viewer SHALL mint a capability before framing a target and frame the returned origin and path; it SHALL mint a fresh one, and re-point the frame to it, on every reopen of the target and 10 minutes before `expiresAt`. Existing `/live/<id>/` admission (genuine local, `legacy` network trust, OAuth session) is unchanged for requests without browser markers; browser-originated requests require a capability.

#### Scenario: Paired LAN browser previews with HMR in pair mode
- **GIVEN** effective trust mode `"pair"` and a browser on `192.168.16.20` holding a `control`-tier device cookie
- **WHEN** the viewer mints a capability for target `vite-5173` and frames the returned origin and path
- **THEN** the page, its scripts and images, its fetches and its HMR WebSocket under that origin and path SHALL all be admitted

#### Scenario: Observe-tier device cannot mint
- **WHEN** a request authenticated by an `observe` device credential calls `POST /api/live-server/vite-5173/capability`
- **THEN** it SHALL be refused with 403 `insufficient_scope` and no token SHALL be created

#### Scenario: Token is bound to one target
- **GIVEN** a valid capability for target `vite-5173`
- **WHEN** a request uses that token under `/live/docs-8080/~c/<token>/`
- **THEN** it SHALL NOT be admitted by the capability

#### Scenario: Capability host is bound to its target and origin
- **GIVEN** a tier-1 capability for `vite-5173` at `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000`
- **WHEN** a request arrives with `Host: k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:9000` or `Host: k7q4zm2x5c6h3v4d5fjqwyabn7.example.com:8000`
- **THEN** it SHALL NOT be admitted by the capability
- **AND** a request on the exact host is proxied only to `vite-5173`

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
- **THEN** the viewer SHALL have minted a new capability and re-pointed the frame to its origin and path

#### Scenario: Revoking the device kills its previews
- **GIVEN** a capability minted by device A
- **WHEN** device A is revoked
- **THEN** the next request using that capability SHALL NOT be admitted

#### Scenario: Upstream sees the plain path
- **WHEN** `GET /live/vite-5173/~c/<token>/src/main.ts` is proxied
- **THEN** the upstream SHALL receive `GET /src/main.ts`
- **AND** `GET http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/src/main.ts` on a tier-1 capability SHALL likewise reach the upstream as `GET /src/main.ts`

#### Scenario: Redirect stays inside the capability
- **WHEN** the upstream answers `302 Location: /login`
- **THEN** the browser SHALL receive `Location: /live/vite-5173/~c/<token>/login` on the legacy path
- **AND** on a tier-1 capability the browser SHALL receive `Location: /login` unchanged (it stays on the capability origin)

#### Scenario: Token not leaked by referrer or logs
- **WHEN** a proxied page without its own referrer policy links to a third-party site
- **THEN** the response SHALL have carried `Referrer-Policy: no-referrer`
- **AND** no server log line SHALL contain the token or the full capability host label

#### Scenario: Tier-1 response carries no-referrer
- **WHEN** a tier-1 capability response is proxied from an upstream that sets no referrer policy
- **THEN** the response carries `Referrer-Policy: no-referrer`

#### Scenario: Upstream referrer policy is replaced on tiers 1-5
- **GIVEN** an upstream that sets `Referrer-Policy: unsafe-url`
- **WHEN** its response is proxied on a tier-1 or tier-5 capability
- **THEN** the browser receives `Referrer-Policy: no-referrer`

#### Scenario: Previews disabled while a tier-1 frame is open
- **GIVEN** a viewer framing a tier-1 capability
- **WHEN** the operator sets `liveServer.previewOrigins.enabled` to `false`
- **THEN** the entry is revoked, the viewer's next keepalive touch fails, and it re-mints and moves the frame to a `/live/<id>/~c/<token>/` legacy path

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

### Requirement: Browser-originated live requests require a capability

A `/live/` or `/preview/` HTTP request or WebSocket upgrade, and any request arriving on a preview host or pool port, that carries `Origin: null` or any `Sec-Fetch-*` header SHALL be served only with a valid capability for that target; otherwise it SHALL return 404 (a `/live/` or `/preview/` path) or be refused by host admission with 403 (a preview host or pool port with no live capability), including for genuinely local callers. A static target SHALL require a valid capability from every caller. Requests without browser markers to `/live/` port targets SHALL keep the existing admission. A `/preview/*` path and any preview host or pool port SHALL have no admission other than a live capability, whatever the caller.

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

#### Scenario: Browser request to a preview path without a live pid
- **WHEN** a browser frame requests `/preview/AAAAAAAAAAAAAAAAAAAAAA/` with `Sec-Fetch-Dest: iframe`
- **THEN** the response is 404

#### Scenario: Browser request to a dead preview host
- **WHEN** a browser requests `http://zzzzzzzzzzzzzzzzzzzzzzzzzz.localhost:8000/` and no live capability has that label
- **THEN** host admission refuses it with 403

#### Scenario: Non-browser caller has no other way into a preview namespace
- **WHEN** a local non-browser client requests `/preview/<unknown pid>/` or a closed pool port
- **THEN** the response is 404 (or the connection is refused for a closed port)

### Requirement: Capability responses enforce the sandbox themselves

Every response served under a capability, for port and static targets, SHALL carry a `Content-Security-Policy` whose `sandbox` directive matches the frame's sandbox for that preview's tier and policy, together with `object-src 'none'` and `frame-ancestors`, so opening the served URL directly in a browser tab still yields a document that cannot reach the dashboard.

- **Tiers 1-4.** The `sandbox` directive SHALL include `allow-same-origin` (without it the header would force an opaque origin): open `sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-downloads`, restricted with scripts `sandbox allow-scripts allow-same-origin allow-forms`, scripts off `sandbox`. `frame-ancestors` SHALL name exactly the dashboard origin(s) from which the capability was minted (the `Origin` of the minting request, or `scheme://Host` when it is absent, e.g. `http://localhost:8000`) plus the capability origin itself (so same-origin nested panes load), and SHALL NOT contain `'self'` or a wildcard. Under the restricted policy the egress source lists SHALL be origin-root: `'self'` is the capability origin itself and path prefixes SHALL NOT be used (the dashboard origin is never allowed), and `frame-src 'self'` SHALL be set so nested same-origin frames (such as the mock site's panes) load, replacing `frame-src 'none'`. The `report-uri` SHALL be the origin-root `/__pi/csp-report` of the capability origin, and reports of the capability origin itself SHALL NOT count as egress. A `POST /__pi/csp-report` on a preview origin or path SHALL be accepted only for a live capability bound to that host, port or `<pid>` (the same binding as the preview request) and otherwise answered 404; such reports SHALL NOT count as egress.
- **Tier 5.** `frame-ancestors 'self'`, a `sandbox` directive without `allow-same-origin` and the path-scoped restricted source lists (prefix `/preview/<pid>`) apply; under the restricted policy `frame-src` SHALL be path-scoped to that prefix instead of `'none'`, so nested same-base frames load.
- **Legacy path.** `frame-ancestors 'self'`, the path-scoped restricted source lists, `frame-src 'none'` and a `sandbox` directive without `allow-same-origin` SHALL be unchanged.

#### Scenario: Direct open stays sandboxed
- **GIVEN** a tier-5 or legacy capability URL of a static or port target
- **WHEN** it is opened in a new top-level browser tab
- **THEN** the document has an opaque origin and cannot read dashboard `localStorage`

#### Scenario: Same-origin nested pane loads (tiers 1-4)
- **GIVEN** a tier-1 capability whose page frames a second page of the same capability origin
- **WHEN** the nested frame loads
- **THEN** its `frame-ancestors` names the dashboard origin and the capability origin, so it is not blocked

#### Scenario: Tier-1 direct open has its own origin
- **GIVEN** a tier-1 capability URL `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/`
- **WHEN** it is opened in a new top-level browser tab
- **THEN** the document's origin is `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000` and it cannot read the `localStorage` of `http://localhost:8000`

#### Scenario: Tier-1 CSP names the exact dashboard origin
- **GIVEN** a capability minted from `http://localhost:8000`
- **WHEN** a response is served on its origin
- **THEN** the `Content-Security-Policy` contains `frame-ancestors http://localhost:8000`
- **AND** its `sandbox` directive contains `allow-same-origin`

#### Scenario: CSP report endpoint needs a live capability
- **GIVEN** a live tier-1 capability, and a tier-5 host with no live `<pid>` `AAAAAAAAAAAAAAAAAAAAAA`
- **WHEN** `POST /__pi/csp-report` arrives on the live capability's origin and `POST /preview/AAAAAAAAAAAAAAAAAAAAAA/__pi/csp-report` arrives on the dashboard origin
- **THEN** the first is accepted and the second is answered 404

#### Scenario: Another site cannot frame a preview
- **WHEN** a page at `http://evil.example` frames `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/`
- **THEN** the browser refuses the frame through `frame-ancestors`

#### Scenario: Restricted tier-1 lists are origin-root with same-origin frames
- **GIVEN** a restricted scripted capability on `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/`
- **WHEN** a response is served
- **THEN** its `connect-src` names the capability origin (`'self'` or its explicit origin) and WebSocket form, not the dashboard origin
- **AND** it contains `frame-src 'self'`

### Requirement: Open in browser uses the real local address for local operators

For a port target the user added, viewed by a genuinely local operator, the open-in-browser affordance SHALL open the target's own `http://localhost:<port>/<path>` address. For agent-declared preset targets, static targets and remote operators it SHALL open the same URL the viewer frame uses, freshly minted: `origin + path` for tiers 1-4, the dashboard origin plus `/preview/<pid>/` for tier 5, or the legacy capability URL.

#### Scenario: Local operator opens the dev server itself
- **GIVEN** a local operator viewing port target `localhost:5173` at `/dashboard`
- **WHEN** they activate open-in-browser
- **THEN** `http://localhost:5173/dashboard` opens

#### Scenario: Agent server never opens on a loopback origin
- **GIVEN** a local operator viewing an agent-declared preset target `localhost:54321`
- **WHEN** they activate open-in-browser
- **THEN** a capability URL such as `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/` opens, not `http://localhost:54321/`

#### Scenario: Remote operator opens the frame's URL
- **GIVEN** a remote operator on a tier-5 host viewing `vite-5173` framed at `/preview/<pid>/`
- **WHEN** they activate open-in-browser
- **THEN** a tab opens at the same `/preview/<pid>/` URL on the dashboard origin

### Requirement: Root-absolute pages explain how to view them

When a document in a tier-5 or legacy-path preview references root-absolute paths (a static target's document, or a port target started without the tier-5 base path), the viewer SHALL explain that those resources cannot resolve inside the preview. On tier 5 the viewer SHALL show the base path `/preview/<pid>/`, a copy button for it, and the instruction to restart the server with this base; on the legacy path it SHALL say the page should be run with a dev server bound to localhost and opened by its localhost URL. On tiers 1-4 the preview is served at the origin root, so root-absolute paths resolve and the viewer SHALL NOT show the hint.

#### Scenario: Hint for root-absolute assets
- **GIVEN** a static target whose page references `/app.js`, framed on the legacy path
- **WHEN** it is framed
- **THEN** the viewer shows the root-absolute hint

#### Scenario: Tier 5 hint shows the base with copy
- **GIVEN** a port target on a tier-5 host whose page references `/@vite/client`
- **WHEN** it is framed at `/preview/<pid>/`
- **THEN** the viewer shows the base `/preview/<pid>/`, a copy button, and "restart your server with this base"

#### Scenario: No hint on a distinct-origin tier
- **GIVEN** a port target framed at `http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000/` whose page references `/@vite/client`
- **WHEN** it is framed
- **THEN** the viewer SHALL NOT show the root-absolute hint
