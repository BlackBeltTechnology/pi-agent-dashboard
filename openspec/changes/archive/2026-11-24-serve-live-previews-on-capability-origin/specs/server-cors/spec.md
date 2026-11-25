## MODIFIED Requirements

### Requirement: Trusted-network origins allowed for LAN-to-LAN switching
The server SHALL CORS-allow a cross-origin request whose `Origin` host matches any entry in `config.resolvedTrustedNetworks` (exact IP, CIDR, or wildcard, via the same matcher used by the network guard), in addition to the existing loopback, live-tunnel, neutral-shell, and configured-origin allowances. This lets a dashboard served on a trusted LAN host probe and switch to another dashboard on the same trusted network. CORS (who may READ a response) remains distinct from auth (bearer/ticket). The refusal of the opaque `Origin: null` is scoped to dashboard routes (every route other than a valid tier-5 live-preview path): on those it is never relaxed by trusted networks or any other allowance. A response under a valid tier-5 `/preview/<pid>/` path (a live capability) answering `Origin: null` SHALL carry `Access-Control-Allow-Origin: null` and `Vary: Origin`, SHALL NOT carry `Access-Control-Allow-Credentials`, and the proxy SHALL replace any upstream `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials` on it; this answer SHALL NOT be produced on `/api/*`, `/ws*`, `/auth/*`, or any other dashboard route, and SHALL NOT be produced for a `/preview/` path without a live capability.

#### Scenario: LAN origin in a trusted network is allowed
- **WHEN** `config.trustedNetworks` contains `192.168.16.0/24`
- **AND** a request arrives with `Origin: http://192.168.16.242:8000`
- **THEN** the server SHALL respond with `Access-Control-Allow-Origin: http://192.168.16.242:8000`

#### Scenario: LAN origin not in any trusted network is rejected
- **WHEN** `config.trustedNetworks` is empty or does not match the origin host
- **AND** a request arrives with `Origin: http://192.168.16.242:8000`
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header (unknown-origin fallthrough, `cb(null, false)`)

#### Scenario: null origin still refused regardless of trusted networks
- **WHEN** a request to a dashboard route (such as `/api/health`) arrives with `Origin: null`
- **AND** `config.trustedNetworks` is permissive (e.g. `0.0.0.0/0`)
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header (the intentional opaque-origin refusal is preserved on dashboard routes)

#### Scenario: Valid tier-5 preview path answers null without credentials
- **WHEN** a live capability `P` is registered and a request to `/preview/P/app.js` arrives with `Origin: null`
- **THEN** the response SHALL carry `Access-Control-Allow-Origin: null` and `Vary: Origin`
- **AND** it SHALL NOT carry `Access-Control-Allow-Credentials`

#### Scenario: Upstream CORS headers on a tier-5 response are overwritten
- **WHEN** the upstream of live capability `P` answers `/preview/P/app.js` with `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Credentials: true` to a request with `Origin: null`
- **THEN** the proxied response SHALL carry `Access-Control-Allow-Origin: null` and SHALL NOT carry `Access-Control-Allow-Credentials`

#### Scenario: Tier-5 preflight from null with a valid pid
- **WHEN** a live capability `P` is registered and `OPTIONS /preview/P/api` arrives with `Origin: null` and `Access-Control-Request-Method: POST`
- **THEN** the response SHALL be `204` with `Access-Control-Allow-Origin: null`, `Vary: Origin`, and no `Access-Control-Allow-Credentials`

#### Scenario: Tier-5 preflight with an unknown pid
- **WHEN** no capability `Q` is registered and `OPTIONS /preview/Q/api` arrives with `Origin: null`
- **THEN** the response SHALL carry no CORS headers

#### Scenario: Unknown preview path gets no null answer
- **WHEN** no capability `Q` is registered and a request to `/preview/Q/app.js` arrives with `Origin: null`
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header

#### Scenario: null origin on dashboard API is refused even beside live previews
- **WHEN** a live capability `P` is registered and `GET /api/sessions` arrives with `Origin: null`
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header

#### Scenario: Empty trusted networks preserves prior behavior
- **WHEN** `config.trustedNetworks` is empty
- **THEN** CORS allowance SHALL consist of loopback, live tunnel origins, the neutral shell, and `cors.allowedOrigins` only

### Requirement: CORS credentials support
The server SHALL set `Access-Control-Allow-Credentials: true` to support cross-origin auth cookies, except responses under a valid `/preview/<pid>/` answering `Origin: null`, which SHALL NOT carry `Access-Control-Allow-Credentials`.

#### Scenario: Cross-origin auth cookies forwarded
- **WHEN** a cross-origin request includes credentials (cookies)
- **THEN** the server SHALL accept and process the cookies

#### Scenario: No credentials on a tier-5 null answer
- **WHEN** a live capability `P` is registered and `/preview/P/app.js` is requested with `Origin: null`
- **THEN** the response SHALL NOT carry `Access-Control-Allow-Credentials`, while a credentialed request from an allowed origin to a dashboard route still receives `Access-Control-Allow-Credentials: true`

## ADDED Requirements

### Requirement: Preview origins are never CORS-admitted
CORS SHALL NOT admit a preview-shaped origin (live or not) through any allowance, a plugin public namespace's `allowedOrigins` included: a cross-origin read of a dashboard route from one gets no `Access-Control-Allow-Origin`. An IP-literal origin with a `portPool` port is always preview-shaped; a static non-IP hostname never is. Order: `null`, preview-deny, loopback, trusted-network, configured. A label-shaped `cors.allowedOrigins` entry under a preview suffix SHALL be rejected at validation.

#### Scenario: Subdomain of localhost is not allowed by the loopback rule
- **WHEN** a capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` is live and `GET /api/health` arrives with `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header

#### Scenario: Plugin allowedOrigins cannot admit a preview origin
- **WHEN** a plugin lists `http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000` in its `allowedOrigins` and a request to `/api/plugins/<id>/public/x` arrives with that `Origin`
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header

#### Scenario: Expired preview label is still not admitted
- **WHEN** capability `a2b3c4d5e6f7g2h3i4j5k6l7m2` has expired and `GET /api/health` arrives with `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header

#### Scenario: Trusted network does not admit a pool-listener origin
- **WHEN** `config.trustedNetworks` contains `192.168.16.0/24`, a pool listener is open at `192.168.16.242:8101`, and `GET /api/health` arrives with `Origin: http://192.168.16.242:8101`
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header

#### Scenario: Trusted-network IP with a pool port is denied
- **WHEN** `config.trustedNetworks` contains `192.168.16.242`, `portPool` is `8100-8199`, and `GET /api/health` arrives with `Origin: http://192.168.16.242:8101` whether or not a listener is open
- **THEN** the server SHALL NOT emit `Access-Control-Allow-Origin`, while `Origin: http://192.168.16.242:8000` is still allowed

#### Scenario: IPv6 and default-port pool origins are normalised
- **GIVEN** `portPool` is `8100-8199` (a valid pool, resolved ports ≥ 1024) and `config.trustedNetworks` contains `192.168.16.242`
- **WHEN** `GET /api/health` arrives with `Origin: http://[::ffff:192.168.16.242]:8101` and, separately, with `Origin: http://192.168.16.242:8101`
- **THEN** both SHALL be treated as the pool origin `192.168.16.242:8101` and SHALL NOT receive `Access-Control-Allow-Origin`
- **AND** `Origin: http://192.168.16.242` (effective port 80) and `Origin: https://192.168.16.242` (effective port 443) are not preview-shaped, because the effective port is the scheme default and is outside the resolved pool, and SHALL receive `Access-Control-Allow-Origin` equal to the origin
- **AND** when `portPool` is invalid (tier 3 disabled) no IP origin is preview-shaped

#### Scenario: Same-origin-by-Host does not admit a preview origin
- **WHEN** a request arrives with `Host: a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000` and `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000` for a live capability `a2b3c4d5e6f7g2h3i4j5k6l7m2`
- **THEN** the server SHALL NOT treat the Origin as same-origin-trusted and SHALL NOT emit `Access-Control-Allow-Origin` for a dashboard route

#### Scenario: Configured origin, tunnel, and neutral shell do not admit a preview origin
- **WHEN** `cors.allowedOrigins`, a live tunnel origin, or the neutral shell would otherwise match an `Origin` of preview shape
- **THEN** the server SHALL NOT emit `Access-Control-Allow-Origin` for it

#### Scenario: Preflight from a preview origin gets no CORS headers
- **WHEN** `OPTIONS /api/config` arrives with `Origin: http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000` for a live capability `a2b3c4d5e6f7g2h3i4j5k6l7m2`
- **THEN** the server SHALL NOT emit `Access-Control-Allow-Origin` or `Access-Control-Allow-Credentials`

#### Scenario: Statically admitted name under localhost keeps working
- **WHEN** `dash.localhost` is in `allowedHosts` and a request arrives with `Origin: http://dash.localhost:8000`
- **THEN** it SHALL be allowed as before, because the name is not preview-shaped

#### Scenario: Label-shaped configured origin is rejected at validation
- **WHEN** `cors.allowedOrigins` contains `http://a2b3c4d5e6f7g2h3i4j5k6l7m2.localhost:8000`
- **THEN** config validation SHALL reject the entry and it SHALL NOT admit the origin
