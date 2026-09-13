## MODIFIED Requirements

### Requirement: WebSocket upgrades reject untrusted Origins
Every WebSocket upgrade on the dashboard listener SHALL be rejected with `HTTP/1.1 403` when the request carries an `Origin` header that is not trusted. Trust SHALL be derived from the dashboard's CORS allow-decision (evaluated against the same live tunnel and configuration state — the gate SHALL NOT keep a separate allow-list) with exactly these deltas: (a) an Origin whose host and port equal the request's `Host` header SHALL be trusted (same-origin by construction) **only when that Host hostname is itself admissible under the host-admission capability, while the host gate is in `enforce` mode** — a `Host` the dashboard cannot justify SHALL NOT vouch for a matching `Origin`; in `report` mode the same-origin-by-Host rule is unchanged, so the report-only rollout refuses nothing the Origin gates admit today; (b) the blanket `*.share.zrok.io` / `*.shares.zrok.io` allowance SHALL NOT apply — only currently live tunnel origins are trusted; (c) the `live` scope handling of `Origin: null` below. An upgrade with no `Origin` header SHALL NOT be rejected by this gate. This gate SHALL run first in the upgrade handler after the host-admission check, for every request path (including `/ws/bridge` and paths that match no route), regardless of whether OAuth is configured, in addition to (never instead of) the existing cookie / ticket / local-token / trusted-network admission.

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
