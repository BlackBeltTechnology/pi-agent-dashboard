## MODIFIED Requirements

### Requirement: Mutating API requests reject untrusted Origins
Requests to `/api/*` and to `/auth/logout` whose method is not `GET`, `HEAD`, or `OPTIONS` SHALL be rejected with HTTP `403` when they carry an `Origin` header that is not trusted (the same trust derivation as the WebSocket gate above, deltas (a) and (b) included; `Origin: null` is untrusted). Requests with no `Origin` header SHALL NOT be rejected by this gate. The gate SHALL run before any route handler, so body-less mutation routes are covered without per-route changes. Path matching SHALL be performed on the routed path, so URL variants such as `//api/...` cannot bypass it.

Exception: for a request under an enabled plugin public namespace (`/api/plugins/<id>/public/`, see `plugin-public-routes`) the trust derivation SHALL be replaced, not extended, by exact string equality of the `Origin` against that plugin's operator-configured `allowedOrigins`; the dashboard origin policy, trusted networks, tunnel and loopback rules SHALL NOT admit an Origin there. Requests with no `Origin` header remain unaffected by this gate; origin pinning is browser hygiene, not authentication — the plugin handler authenticates every request. The namespace decision SHALL be the `plugin-public-routes` predicate (both raw and resolved path under the namespace), with the plugin id taken from that path, so `//api/...`, dot-segment and encoded variants cannot select a namespace or escape this gate.

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

#### Scenario: Public-namespace mutation from a configured customer origin is admitted
- **WHEN** a `POST` to `/api/plugins/web-chat/public/messages` carries `Origin: https://shop.example` and `https://shop.example` is in the plugin's `allowedOrigins`
- **THEN** this gate SHALL NOT reject it

#### Scenario: Dashboard-trusted origin is not admitted on a public namespace
- **WHEN** a `POST` to `/api/plugins/web-chat/public/messages` carries a loopback or configured dashboard `Origin` that is not in the plugin's `allowedOrigins`
- **THEN** it SHALL be rejected with `403`

#### Scenario: Customer origin gains nothing outside the public namespace
- **WHEN** a `POST` to any other `/api/*` route carries `Origin: https://shop.example`
- **THEN** it SHALL be rejected with `403` exactly as before this change
