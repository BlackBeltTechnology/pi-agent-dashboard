## MODIFIED Requirements

### Requirement: WebSocket upgrades reject untrusted Origins
Every WebSocket upgrade on the dashboard listener SHALL be rejected with `HTTP/1.1 403` when the request carries an `Origin` header that is not trusted. Trust SHALL be derived from the dashboard's CORS allow-decision (evaluated against the same live tunnel and configuration state — the gate SHALL NOT keep a separate allow-list) with exactly these deltas: (a) an Origin whose host and port equal the request's `Host` header SHALL be trusted (same-origin by construction) **only when that Host hostname is itself admissible under the host-admission capability, while the host gate is in `enforce` mode** — a `Host` the dashboard cannot justify SHALL NOT vouch for a matching `Origin`; in `report` mode the same-origin-by-Host rule is unchanged, so the report-only rollout refuses nothing the Origin gates admit today, except preview-shaped Origins, which are refused in both modes; (b) the blanket `*.share.zrok.io` / `*.shares.zrok.io` allowance SHALL NOT apply — only currently live tunnel origins are trusted; (c) the `live` scope handling of `Origin: null` below. An upgrade with no `Origin` header SHALL NOT be rejected by this gate. Upgrades dispatched to the preview namespace (by preview-shaped `Host` or pool listener) never reach this gate. This gate SHALL run first in the upgrade handler after the host-admission check, for every request path (including `/ws/bridge` and paths that match no route), regardless of whether OAuth is configured, in addition to (never instead of) the existing cookie / ticket / local-token / trusted-network admission.

#### Scenario: Loopback peer with attacker Origin is rejected
- **WHEN** a WebSocket upgrade for `/ws` arrives from a loopback peer with `Origin: http://attacker.example`
- **THEN** the server SHALL respond `HTTP/1.1 403` and destroy the socket

#### Scenario: Loopback peer with loopback Origin is admitted
- **WHEN** a WebSocket upgrade for `/ws` arrives from a loopback peer with `Origin: http://localhost:8000` (or any loopback host on any port)
- **THEN** this gate SHALL NOT reject it, and the existing admission logic SHALL decide the upgrade (under the default `requireLocalProof`, a bare loopback peer needs local proof to complete it)

#### Scenario: Header-less local client is admitted
- **WHEN** a WebSocket upgrade for `/ws` arrives from a loopback peer with no `Origin` header
- **THEN** this gate SHALL NOT reject it, and the existing admission logic SHALL decide the upgrade (under the default `requireLocalProof`, a bare loopback peer needs local proof to complete it)

#### Scenario: Terminal upgrade with attacker Origin is rejected even for a live terminal id
- **WHEN** a terminal exists with id `T` and a WebSocket upgrade for `/ws/terminal/T` arrives from a loopback peer with `Origin: http://attacker.example`
- **THEN** the server SHALL respond `HTTP/1.1 403` and no client SHALL be attached to the terminal

#### Scenario: Untrusted Origin does not consume a ticket
- **WHEN** a WebSocket upgrade carries a valid single-use ticket and an untrusted `Origin`
- **THEN** the server SHALL reject the upgrade and the ticket SHALL remain unconsumed

#### Scenario: Hostname-addressed same-origin client is admitted
- **WHEN** a WebSocket upgrade for `/ws` arrives with `Host: mac.local:8000` and `Origin: http://mac.local:8000`, and `mac.local` appears in no configured origin or trusted network
- **THEN** the Origin gate SHALL NOT reject the upgrade, because `mac.local` is an admissible hostname

#### Scenario: Rebinding Origin/Host pair is not same-origin-trusted
- **WHEN** the host gate is in `enforce` mode and a WebSocket upgrade for `/ws` arrives with `Host: rebind.example:8000` and `Origin: http://rebind.example:8000`, and `rebind.example` is not an admissible hostname
- **THEN** the same-origin-by-Host rule SHALL NOT trust the Origin and the upgrade SHALL be rejected with `HTTP/1.1 403`

#### Scenario: Report mode keeps the same-origin-by-Host rule
- **WHEN** the host gate is in `report` mode and a WebSocket upgrade for `/ws` arrives with `Host: proxy-int.corp:8000` and `Origin: http://proxy-int.corp:8000`, and `proxy-int.corp` is not an admissible hostname
- **THEN** the Origin gate SHALL NOT reject the upgrade and one `[host-gate] would-refuse` line SHALL be logged

#### Scenario: Stranger zrok share is rejected
- **WHEN** no live tunnel has origin `https://xyz.share.zrok.io` and a WebSocket upgrade arrives with `Origin: https://xyz.share.zrok.io`
- **THEN** the server SHALL respond `HTTP/1.1 403`

#### Scenario: Live tunnel origin is admitted
- **WHEN** the active tunnel origin is `https://abc.share.zrok.io` and a WebSocket upgrade arrives with `Origin: https://abc.share.zrok.io`
- **THEN** the Origin gate SHALL NOT reject the upgrade

#### Scenario: Configured origin is admitted
- **WHEN** `cors.allowedOrigins` contains `https://dash.example` and a WebSocket upgrade arrives with `Origin: https://dash.example`
- **THEN** the Origin gate SHALL NOT reject the upgrade

#### Scenario: Unrouted path with attacker Origin is rejected before any other response
- **WHEN** a WebSocket upgrade for `/ws/bridge` (or any path matching no WS route) arrives with `Origin: http://attacker.example`
- **THEN** the server SHALL respond `HTTP/1.1 403` (not the route's own `400`/destroy)

#### Scenario: Preview-namespace upgrade does not reach this gate
- **WHEN** a capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live and a WebSocket upgrade arrives with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** it SHALL be dispatched to the preview namespace by the preview dispatcher and SHALL NOT be evaluated by this gate

#### Scenario: Preview-shaped Origin is refused in report mode
- **WHEN** the host gate is in `report` mode and a WebSocket upgrade for `/ws` arrives with `Host: localhost:8000` and `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** the upgrade SHALL be rejected with `HTTP/1.1 403` (report mode does not relax preview-shaped Origins)

### Requirement: Opaque `null` Origin is scope-dependent
The `browser` (`/ws`) and `terminal` (`/ws/terminal/:id`) scopes SHALL reject `Origin: null`. The `live` scope, covering `/live/:id` and `/preview/:pid` (valid `<pid>` only), SHALL admit `Origin: null`, because the sandboxed opaque-origin preview iframe is that scope's intended client.

#### Scenario: null Origin on the browser gateway is rejected
- **WHEN** a WebSocket upgrade for `/ws` arrives with `Origin: null`
- **THEN** the server SHALL respond `HTTP/1.1 403`

#### Scenario: null Origin on a live preview route is admitted
- **WHEN** a live preview `L` is registered and a WebSocket upgrade for `/live/L` arrives from a loopback peer with `Origin: null`
- **THEN** the Origin gate SHALL NOT reject the upgrade

#### Scenario: Attacker Origin on a live preview route is rejected
- **WHEN** a WebSocket upgrade for `/live/L` arrives with `Origin: http://attacker.example`
- **THEN** the server SHALL respond `HTTP/1.1 403`

#### Scenario: null Origin on a valid tier-5 preview path is admitted
- **WHEN** a tier-5 capability with pid `P` is live and a WebSocket upgrade for `/preview/P/` arrives with `Origin: null`
- **THEN** the Origin gate SHALL NOT reject the upgrade

#### Scenario: null Origin on an unknown preview pid is rejected
- **WHEN** no capability has pid `Q` and a WebSocket upgrade for `/preview/Q/` arrives with `Origin: null`
- **THEN** the server SHALL respond `HTTP/1.1 403`

### Requirement: Mutating API requests reject untrusted Origins
Requests to `/api/*` and to `/auth/logout` whose method is not `GET`, `HEAD`, or `OPTIONS` SHALL be rejected with HTTP `403` when they carry an `Origin` header that is not trusted (the same trust derivation as the WebSocket gate above, deltas (a) and (b) included; `Origin: null` is untrusted). Requests with no `Origin` header SHALL NOT be rejected by this gate. The gate SHALL run before any route handler, so body-less mutation routes are covered without per-route changes. Path matching SHALL be performed on the routed path, so URL variants such as `//api/...` cannot bypass it.

#### Scenario: Cross-site body-less POST is rejected
- **WHEN** `POST /api/tunnel-connect` arrives from a loopback peer with `Origin: http://attacker.example` and no body
- **THEN** the server SHALL respond `403` and SHALL NOT change tunnel state

#### Scenario: Same-origin dashboard POST is admitted
- **WHEN** `POST /api/tunnel-connect` arrives with `Origin: http://localhost:8000`
- **THEN** the gate SHALL NOT reject the request

#### Scenario: Header-less CLI request is admitted
- **WHEN** `POST /api/restart` arrives with no `Origin` header
- **THEN** the gate SHALL NOT reject the request

#### Scenario: Plain-LAN pairing page can pair
- **WHEN** `POST /api/pair/challenge` arrives with `Host: 192.168.1.5:8000` and `Origin: http://192.168.1.5:8000`
- **THEN** the gate SHALL NOT reject the request

#### Scenario: Cross-site logout is rejected
- **WHEN** `POST /auth/logout` arrives with `Origin: http://attacker.example`
- **THEN** the server SHALL respond `403` and the session cookie SHALL remain

#### Scenario: Double-slash path variant does not bypass the gate
- **WHEN** `POST //api/tunnel-connect` arrives with `Origin: http://attacker.example`
- **THEN** the request SHALL NOT reach the route handler with the gate skipped (either `403` or not routed)

#### Scenario: Cross-site GET is not affected by this gate
- **WHEN** `GET /api/health` arrives with `Origin: http://attacker.example`
- **THEN** the gate SHALL NOT reject the request (response readability remains governed by CORS)

#### Scenario: Preflight is not affected by this gate
- **WHEN** `OPTIONS /api/config` arrives with `Origin: http://attacker.example`
- **THEN** the gate SHALL NOT reject the request

#### Scenario: Plain-LAN dashboard Host outside the port pool still pairs
- **WHEN** `portPool` is `8100-8199` and `POST /api/pair/challenge` arrives with `Host: 192.168.1.5:8000` and `Origin: http://192.168.1.5:8000`
- **THEN** the gate SHALL NOT reject the request, because port `8000` is not in `portPool` and the Origin is not preview-shaped

## ADDED Requirements

### Requirement: Preview origins are never trusted origins
An `Origin` of preview shape (live or not) SHALL NOT be trusted by either gate on `/api/*` (plugin public namespaces included), `/ws*`, or `/auth/*` and SHALL get `403` (`HTTP/1.1 403` for upgrades) before any handler, ticket, cookie or plugin `allowedOrigins` admission, logged with the label redacted. An IP-literal origin with a `portPool` port is always preview-shaped; a statically admitted non-IP hostname never is. Order: `null`, preview-deny, loopback, trusted-network, configured.

#### Scenario: Preview origin WebSocket upgrade is rejected
- **WHEN** a capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live and a WebSocket upgrade for `/ws` arrives with `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** the server SHALL respond `HTTP/1.1 403` and any single-use ticket SHALL remain unconsumed

#### Scenario: Preview origin is refused on a plugin public route
- **WHEN** a `POST` to `/api/plugins/web-chat/public/messages` carries `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`, even if that origin is listed in the plugin's `allowedOrigins`
- **THEN** the server SHALL respond `403` before the plugin public-namespace decision and the route handler SHALL NOT run

#### Scenario: Preview origin mutation is rejected
- **WHEN** a capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live and `POST /api/tunnel-connect` arrives with `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** the server SHALL respond `403` and the route handler SHALL NOT run

#### Scenario: Same-site preview origin is still rejected
- **WHEN** the dashboard is `https://dash.example.com`, a capability is live at `https://a2b3c4d5e6f7g2h3i4j5k6l7m2.preview.example.com`, and `POST /auth/logout` arrives with `Origin: https://a2b3c4d5e6f7g2h3i4j5k6l7m2.preview.example.com`
- **THEN** the server SHALL respond `403` and the session cookie SHALL remain

#### Scenario: Preview origin matching the request Host is not same-origin-trusted
- **WHEN** a mutating request arrives at the dashboard with `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000` and a `Host` equal to that Origin's host, or from a loopback peer or trusted network
- **THEN** neither the same-origin-by-Host rule nor the loopback or trusted-network rule SHALL trust it and the server SHALL respond `403`

#### Scenario: Preview origin is rejected in report mode
- **WHEN** the host gate is in `report` mode and a mutation or `/ws` upgrade arrives with `Host: localhost:8000` and `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000` (a live label as `Host` would instead be dispatched to the preview namespace)
- **THEN** the Origin SHALL NOT be trusted and the request SHALL be rejected with `403` (`HTTP/1.1 403` for the upgrade)

#### Scenario: Pool-listener origin is rejected
- **WHEN** a pool listener is open at `192.168.1.5:8101` and `POST /api/restart` arrives at the dashboard with `Origin: http://192.168.1.5:8101`
- **THEN** the server SHALL respond `403`

#### Scenario: Pool-port origin is rejected despite a trusted network
- **WHEN** `trustedNetworks` contains `192.168.1.5`, `portPool` is `8100-8199`, and a mutation and a `/ws` upgrade arrive with `Origin: http://192.168.1.5:8101` (listener open or not)
- **THEN** both SHALL be rejected with `403` / `HTTP/1.1 403`, because a pool-port IP origin is preview-shaped before the trusted-network rule runs

#### Scenario: Preview origin that is no longer live is also untrusted
- **WHEN** capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` has expired and a WebSocket upgrade for `/ws` arrives with `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** the server SHALL respond `HTTP/1.1 403`

#### Scenario: Statically admitted name under localhost keeps working
- **WHEN** `dash.localhost` is a statically admitted dashboard hostname and `POST /api/tunnel-connect` and a `/ws` upgrade arrive with `Host: dash.localhost:8000` and `Origin: http://dash.localhost:8000`
- **THEN** neither SHALL be rejected by this rule, because the name is not preview-shaped

#### Scenario: Duplicated cookie beats a preview Origin
- **WHEN** `POST /api/sessions` arrives on the dashboard listener with `Cookie: pi_dash_token=a; pi_dash_token=b` and `Origin: http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000`
- **THEN** the response is `400` (not `403`), carries no `Access-Control-Allow-Origin`, and no route handler runs
- **AND** a request with a single `pi_dash_token` and the same `Origin` is `403`

### Requirement: Duplicated dashboard cookie names are refused
A request to the dashboard listener whose `Cookie` repeats any `pi_dash_` name SHALL be refused before authentication, ticket or route handling, on HTTP and WebSocket upgrades, every path including `/auth/*` and pairing. Status `400` (not `401`, which would loop sign-in); `HTTP/1.1 400` for upgrades. The HTTP body follows the host-gate `Accept` rule (first media type `text/html` → HTML page, else JSON). A name seen once, or a duplicated non-`pi_dash_` name, SHALL NOT trigger it.

#### Scenario: Duplicated session cookie is refused
- **WHEN** `GET /api/sessions` arrives with `Cookie: pi_dash_token=a; pi_dash_token=b`
- **THEN** the server SHALL respond `400` and the route handler SHALL NOT run

#### Scenario: Duplicated cookie on a WebSocket upgrade is refused
- **WHEN** a WebSocket upgrade for `/ws` arrives with `Cookie: pi_dash_local=a; x=1; pi_dash_local=b`
- **THEN** the server SHALL respond `HTTP/1.1 400` whose head carries the expiring `Set-Cookie` lines for `pi_dash_local`, destroy the socket, and any single-use ticket SHALL remain unconsumed

#### Scenario: Accept header selects the refusal body
- **WHEN** duplicated `pi_dash_token` requests arrive with `Accept: text/html,application/xhtml+xml` and with `Accept: application/json`
- **THEN** the first SHALL receive an HTML page and the second a JSON body, both `400`

#### Scenario: Single dashboard cookies are admitted to normal handling
- **WHEN** a request arrives with `Cookie: pi_dash_token=a; pi_dash_local=b`
- **THEN** this gate SHALL NOT refuse the request

#### Scenario: Gate order is host gate, then duplicate cookie, then origin gates
- **GIVEN** `Host` is an admitted dashboard host
- **WHEN** a request carries a duplicated `pi_dash_token` and a preview or otherwise untrusted `Origin`
- **THEN** the duplicate-cookie `400` wins; a refused `Host` is answered `403` by the host gate before either; the `400` response carries no CORS headers

#### Scenario: Duplicated foreign cookie is not affected
- **WHEN** a request arrives with `Cookie: theme=a; theme=b`
- **THEN** this gate SHALL NOT refuse the request

#### Scenario: Duplicated OAuth state cookie on the callback is refused and recoverable
- **WHEN** `GET /auth/callback` arrives with `Cookie: pi_dash_oauth_state=a; pi_dash_oauth_state=b`
- **THEN** the server SHALL respond `400` with an expiring `Set-Cookie` for `pi_dash_oauth_state`, and a retry of the sign-in flow SHALL succeed

#### Scenario: Duplicated cookie on pairing challenge is refused and recoverable
- **WHEN** `POST /api/pair/challenge` arrives with `Cookie: pi_dash_local=a; pi_dash_local=b`
- **THEN** the server SHALL respond `400` with an expiring `Set-Cookie` for `pi_dash_local`, and a retry without the duplicate SHALL proceed to normal handling

### Requirement: Duplicate-cookie refusals expire the shadowing cookie and are logged
The `400` refusal (HTTP, and the upgrade head) SHALL expire the duplicated name with host-only `Set-Cookie` at `/`, `/api/`, `/auth/`, every `/`-boundary prefix of the request path with and without a trailing slash, and the exact path; with tier 2 configured, also with `Domain=<d>` for each ancestor domain of the Host having ≥2 labels. Logged rate-limited, one line per name per minute: name(s), count, method, route scope; never a value.

#### Scenario: Refusal expires the name at every path prefix
- **WHEN** `GET /api/sessions/abc/events` is refused for a duplicated `pi_dash_token`
- **THEN** the response SHALL carry expiring `Set-Cookie` headers for `pi_dash_token` at `/`, `/api`, `/api/`, `/api/sessions`, `/api/sessions/`, `/api/sessions/abc`, `/api/sessions/abc/`, `/api/sessions/abc/events`, and `/auth/`

#### Scenario: A `Path=/api/` toss is cleared
- **WHEN** an attacker-planted `pi_dash_token` with `Path=/api/` shadows the real one and the next request is refused
- **THEN** the response SHALL expire `pi_dash_token` at `/api/`, so the following request is not duplicated

#### Scenario: Refusal also expires the parent-domain cookie when tier 2 is configured
- **WHEN** `liveServer.previewOrigins.wildcard` is active (suffix `preview.a.example.com`, `forHosts` containing `dash.a.example.com`, `enabled` true) and `GET /api/health` with `Host: dash.a.example.com` is refused for a duplicated `pi_dash_token`
- **THEN** the response SHALL also expire `pi_dash_token` with `Domain=a.example.com` and with `Domain=example.com`

#### Scenario: Refusal is logged without values and rate-limited
- **WHEN** ten requests are refused within one minute for a duplicated `pi_dash_token`
- **THEN** one log line SHALL contain `pi_dash_token`, the count, the method and the route scope, and SHALL NOT contain either cookie value

#### Scenario: Domain variants only for a hostname Host with an active tier 2
- **GIVEN** tier 2 is active
- **WHEN** a duplicated `pi_dash_token` is refused for `Host: 192.168.1.5:8000`, or for `Host: localhost:8000`
- **THEN** the response SHALL carry no `Domain=` expiry line
- **AND** with `Host: dash.example.com` only `Domain=example.com` is emitted, never a single-label domain such as `com`
- **AND** with tier 2 invalid, disabled or `enabled:false`, a hostname Host gets no `Domain=` line

#### Scenario: Cookie names and echoed paths are bounded
- **WHEN** a request with a 300-character duplicated `pi_dash_` cookie name is refused
- **THEN** the JSON `cookie` field and the log line carry that name truncated to 128 characters
- **WHEN** a request path has 20 segments
- **THEN** expiry lines cover only the prefixes of its first 16 segments (with and without trailing slash), and no `Set-Cookie` carries a deeper path
- **AND** the response carries at most 64 `Set-Cookie` lines, host-only lines first

#### Scenario: Log limiter is bounded
- **WHEN** 257 distinct duplicated names are refused within one minute
- **THEN** the limiter holds at most 256 names, evicting the least recently used, and still logs at most one line per name per minute
