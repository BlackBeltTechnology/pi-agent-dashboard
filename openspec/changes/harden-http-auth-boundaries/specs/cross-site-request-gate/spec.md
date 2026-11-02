## MODIFIED Requirements

### Requirement: WebSocket upgrades reject untrusted Origins
Every WebSocket upgrade on the dashboard listener SHALL be rejected with `HTTP/1.1 403` when the request carries an `Origin` header that is not trusted. Trust SHALL be derived from the dashboard's CORS allow-decision (evaluated against the same live tunnel and configuration state — the gate SHALL NOT keep a separate allow-list) with exactly these deltas: (a) an Origin whose host and port equal the request's `Host` header SHALL be trusted (same-origin by construction) **only when that Host hostname is itself admissible under the host-admission capability, while the host gate is in `enforce` mode** — a `Host` the dashboard cannot justify SHALL NOT vouch for a matching `Origin`; in `report` mode the same-origin-by-Host rule is unchanged, so the report-only rollout refuses nothing the Origin gates admit today; (b) the blanket `*.share.zrok.io` / `*.shares.zrok.io` allowance SHALL NOT apply — only currently live tunnel origins are trusted; (c) the `live` scope handling of `Origin: null` below. An upgrade with no `Origin` header SHALL NOT be rejected by this gate. This gate SHALL run first in the upgrade handler after the host-admission check, for every request path (including `/ws/bridge` and paths that match no route), regardless of whether OAuth is configured, in addition to (never instead of) the existing cookie / ticket / local-token / trusted-network admission.

#### Scenario: Loopback peer with attacker Origin is rejected
- **WHEN** a WebSocket upgrade for `/ws` arrives from a loopback peer with `Origin: http://attacker.example`
- **THEN** the server SHALL respond `HTTP/1.1 403` and destroy the socket

#### Scenario: Loopback peer with loopback Origin is admitted
- **WHEN** a WebSocket upgrade for `/ws` arrives from a loopback peer with `Origin: http://localhost:8000` (or any loopback host on a dashboard listener port)
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


## ADDED Requirements

### Requirement: A loopback Origin is trusted only on a dashboard listener port
The CORS read, mutating-request and WebSocket-upgrade gates SHALL trust an `Origin` whose host is `localhost`, `127.0.0.1` or `[::1]` (the existing literals, no `127.0.0.0/8` widening) only on a scheme and port the dashboard listens on (`http` on the HTTP port; `https` on the TLS port), captured at bind; `trustedNetworks` SHALL NOT admit it. On any other port it is unlisted unless in `cors.allowedOrigins`. One predicate decides all three; no port list trusts none.

#### Scenario: Page on another loopback port cannot mutate
- **WHEN** `POST /api/session/spawn` arrives from a loopback peer with `Origin: http://localhost:3000` and the dashboard listens on 8000
- **THEN** the server SHALL respond `403` and SHALL NOT spawn a session, even when the request carries a valid `pi_dash_local` cookie

#### Scenario: Page on another loopback port cannot read
- **WHEN** `GET /api/sessions` arrives with `Origin: http://localhost:3000`
- **THEN** the response SHALL carry no `Access-Control-Allow-Origin`, so the page cannot read it

#### Scenario: Page on another loopback port cannot open a socket
- **WHEN** a WebSocket upgrade for `/ws` carries `Origin: http://127.0.0.1:3000` and a valid single-use ticket
- **THEN** the server SHALL respond `HTTP/1.1 403` and the ticket SHALL remain unconsumed

#### Scenario: A trusted-network entry does not rescue a loopback port
- **GIVEN** `trustedNetworks: ["127.0.0.1"]` and the dashboard listening on 8000
- **WHEN** a mutating request, a CORS read and a WebSocket upgrade each carry `Origin: http://127.0.0.1:3000`
- **THEN** all three SHALL be refused, and the same origin on port 8000 SHALL still be admitted

#### Scenario: Dashboard's own origins are admitted under either loopback name
- **WHEN** a mutating request carries `Origin: http://127.0.0.1:8000` while the dashboard listens on 8000
- **THEN** the gate SHALL NOT reject it

#### Scenario: TLS listener port is a dashboard port
- **WHEN** the TLS listener was bound on 8443 and a mutating request carries `Origin: https://localhost:8443`
- **THEN** the gate SHALL NOT reject it, while `http://localhost:8443` SHALL be refused

#### Scenario: Wrong scheme on the HTTP listener port is refused
- **WHEN** the dashboard listens on plain HTTP 8000 and a request carries `Origin: https://localhost:8000`
- **THEN** the loopback rule SHALL NOT admit it

#### Scenario: Listener set is fixed at bind
- **GIVEN** the server bound HTTP 8000 with TLS off
- **WHEN** the operator edits `tls.enabled`, `tls.port` or `port` in the config without a restart
- **THEN** the admitted loopback origins SHALL NOT change until the next start
- **AND** the bind family (a same-user process on `[::1]` while the dashboard is bound IPv4-only) is an accepted residual

#### Scenario: Operator-listed loopback origin is admitted
- **WHEN** `cors.allowedOrigins` contains `http://localhost:5173` and a request carries that `Origin`
- **THEN** CORS, the mutation gate and the WebSocket gate SHALL admit it

#### Scenario: Reverse-proxied dev server is admitted by Host
- **WHEN** a Vite dev server on 5173 proxies `/api` to the dashboard and the request arrives with `Host: localhost:5173` and `Origin: http://localhost:5173`
- **THEN** the same-origin-by-Host rule SHALL admit it

#### Scenario: Missing port list fails closed
- **WHEN** the gate is evaluated with no listener-port source
- **THEN** no loopback `Origin` SHALL be trusted by the loopback rule

#### Scenario: Refused loopback origin raises the origin-denial prompt path
- **WHEN** a CORS request from `http://localhost:3000` is refused
- **THEN** it SHALL flow through the existing origin-denial observer exactly as any other refused origin

