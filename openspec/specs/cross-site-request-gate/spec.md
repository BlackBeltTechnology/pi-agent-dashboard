# cross-site-request-gate Specification

## Purpose
Prevents web pages on other origins from driving the dashboard through the victim's own browser: admits WebSocket upgrades and mutating `/api/*` requests only when their `Origin` header is absent or trusted.

## Requirements

### Requirement: WebSocket upgrades reject untrusted Origins
Every WebSocket upgrade on the dashboard listener SHALL be rejected with `HTTP/1.1 403` when the request carries an `Origin` header that is not trusted. Trust SHALL be derived from the dashboard's CORS allow-decision (evaluated against the same live tunnel and configuration state — the gate SHALL NOT keep a separate allow-list) with exactly these deltas: (a) an Origin whose host and port equal the request's `Host` header SHALL be trusted (same-origin by construction); (b) the blanket `*.share.zrok.io` / `*.shares.zrok.io` allowance SHALL NOT apply — only currently live tunnel origins are trusted; (c) the `live` scope handling of `Origin: null` below. An upgrade with no `Origin` header SHALL NOT be rejected by this gate. This gate SHALL run first in the upgrade handler, for every request path (including `/ws/bridge` and paths that match no route), regardless of whether OAuth is configured, in addition to (never instead of) the existing cookie / ticket / local-token / trusted-network admission.

#### Scenario: Loopback peer with attacker Origin is rejected
- **WHEN** a WebSocket upgrade for `/ws` arrives from a loopback peer with `Origin: http://attacker.example`
- **THEN** the server SHALL respond `HTTP/1.1 403` and destroy the socket

#### Scenario: Loopback peer with loopback Origin is admitted
- **WHEN** a WebSocket upgrade for `/ws` arrives from a loopback peer with `Origin: http://localhost:8000` (or any loopback host on any port)
- **THEN** the server SHALL proceed with the existing admission logic and complete the upgrade

#### Scenario: Header-less local client is admitted
- **WHEN** a WebSocket upgrade for `/ws` arrives from a loopback peer with no `Origin` header
- **THEN** the server SHALL proceed with the existing admission logic and complete the upgrade

#### Scenario: Terminal upgrade with attacker Origin is rejected even for a live terminal id
- **WHEN** a terminal exists with id `T` and a WebSocket upgrade for `/ws/terminal/T` arrives from a loopback peer with `Origin: http://attacker.example`
- **THEN** the server SHALL respond `HTTP/1.1 403` and no client SHALL be attached to the terminal

#### Scenario: Untrusted Origin does not consume a ticket
- **WHEN** a WebSocket upgrade carries a valid single-use ticket and an untrusted `Origin`
- **THEN** the server SHALL reject the upgrade and the ticket SHALL remain unconsumed

#### Scenario: Hostname-addressed same-origin client is admitted
- **WHEN** a WebSocket upgrade for `/ws` arrives with `Host: mac.local:8000` and `Origin: http://mac.local:8000`, and `mac.local` appears in no configured origin or trusted network
- **THEN** the Origin gate SHALL NOT reject the upgrade

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

### Requirement: pi-gateway TCP upgrades reject any Origin
The pi-gateway TCP WebSocket listener SHALL refuse any upgrade that carries an `Origin` header, whatever its value, because no browser is a legitimate bridge peer. The refusal SHALL take precedence over the tokenless-loopback deprecation grace and over ticket / local-token admission. Unix-socket peers are unaffected.

#### Scenario: Browser dial to the pi port is refused
- **WHEN** a WebSocket upgrade arrives on the pi-gateway TCP port from a loopback peer with `Origin: http://attacker.example` and no ticket
- **THEN** the gateway SHALL refuse the upgrade with `401` and SHALL NOT register a session

#### Scenario: Loopback Origin on the pi port is still refused
- **WHEN** a WebSocket upgrade arrives on the pi-gateway TCP port with `Origin: http://localhost:8000`
- **THEN** the gateway SHALL refuse the upgrade

#### Scenario: Header-less bridge is admitted as before
- **WHEN** a WebSocket upgrade arrives on the pi-gateway TCP port from a loopback peer with no `Origin` header
- **THEN** admission SHALL follow the existing ticket / local-token / deprecation-grace rules unchanged

### Requirement: Opaque `null` Origin is scope-dependent
The `browser` (`/ws`) and `terminal` (`/ws/terminal/:id`) scopes SHALL reject `Origin: null`. The `live` (`/live/:id`) scope SHALL admit `Origin: null`, because the sandboxed opaque-origin preview iframe is that route's intended client.

#### Scenario: null Origin on the browser gateway is rejected
- **WHEN** a WebSocket upgrade for `/ws` arrives with `Origin: null`
- **THEN** the server SHALL respond `HTTP/1.1 403`

#### Scenario: null Origin on a live preview route is admitted
- **WHEN** a live preview `L` is registered and a WebSocket upgrade for `/live/L` arrives from a loopback peer with `Origin: null`
- **THEN** the Origin gate SHALL NOT reject the upgrade

#### Scenario: Attacker Origin on a live preview route is rejected
- **WHEN** a WebSocket upgrade for `/live/L` arrives with `Origin: http://attacker.example`
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

### Requirement: Rejections are logged
Each rejection by either gate SHALL emit one server log line naming the gate, the offending `Origin`, and the route scope or `<method> <path>`, so an attempted cross-site hijack is visible in `server.log`.

#### Scenario: Rejected upgrade is logged
- **WHEN** a WebSocket upgrade is rejected for an untrusted Origin
- **THEN** the server log SHALL contain a line identifying the WS gate, the Origin value, and the route scope

#### Scenario: Rejected mutation is logged
- **WHEN** a mutating `/api/*` request is rejected for an untrusted Origin
- **THEN** the server log SHALL contain a line identifying the API gate, the Origin value, the method and the path
