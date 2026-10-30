## MODIFIED Requirements

### Requirement: CORS enabled on dashboard server
The server SHALL register `@fastify/cors` to handle cross-origin requests from separately-hosted clients. A loopback origin is allowed only on a dashboard listener port (see `cross-site-request-gate` "A loopback Origin is trusted only on a dashboard listener port").

Requests under an enabled plugin public namespace (`/api/plugins/<id>/public/`, see `plugin-public-routes`) are excluded from this registration's origin decision; the host answers CORS for them from that plugin's own `allowedOrigins` only, ahead of this registration, so none of this capability's origin rules (localhost, `cors.allowedOrigins`, neutral shell origin, trusted-network origins, live tunnel origins, prompt-granted origins) applies there, and a namespace origin gains no CORS grant anywhere else.

#### Scenario: Same-origin requests pass through
- **WHEN** a request has no `Origin` header (same-origin)
- **THEN** the server SHALL process it normally without CORS headers

#### Scenario: Localhost origins allowed by default
- **WHEN** a request comes from `http://localhost:8000` or `http://127.0.0.1:8000`, where 8000 is a port the dashboard itself listens on
- **THEN** the server SHALL respond with `Access-Control-Allow-Origin` matching the request origin

#### Scenario: Loopback origin on another port is not allowed
- **WHEN** a request comes from `http://localhost:3000` (not a dashboard listener port, not in `cors.allowedOrigins`)
- **THEN** the server SHALL NOT send `Access-Control-Allow-Origin` and SHALL reject the CORS preflight

#### Scenario: Loopback origin on another port is not rescued by trustedNetworks
- **GIVEN** `trustedNetworks` contains `127.0.0.1` (or `localhost`)
- **WHEN** a request comes from `http://127.0.0.1:3000`
- **THEN** the server SHALL NOT send `Access-Control-Allow-Origin`

#### Scenario: Configured origins allowed
- **WHEN** `cors.allowedOrigins` in config contains `https://dashboard.example.com`
- **AND** a request comes from `https://dashboard.example.com`
- **THEN** the server SHALL respond with matching `Access-Control-Allow-Origin`

#### Scenario: Unknown origins rejected
- **WHEN** a request comes from `https://evil.example.com` not in config
- **THEN** the server SHALL reject the CORS preflight

#### Scenario: Localhost origin gets no grant on a public namespace
- **WHEN** a request from `http://localhost:3000` targets an enabled public namespace whose `allowedOrigins` does not list it
- **THEN** no `Access-Control-Allow-Origin` header SHALL be sent

#### Scenario: Namespace origin gets no grant on core routes
- **WHEN** a request from `https://shop.example` (listed only in a plugin's public `allowedOrigins`) targets `/api/sessions`
- **THEN** the server SHALL reject the CORS preflight exactly as for any unknown origin

### Requirement: CORS config field
The dashboard config (`~/.pi/dashboard/config.json`) SHALL support a `cors` object with an `allowedOrigins` string array.

#### Scenario: Config with allowed origins
- **WHEN** config contains `{ "cors": { "allowedOrigins": ["https://ui.example.com"] } }`
- **THEN** the server SHALL allow requests from `https://ui.example.com`

#### Scenario: No cors config uses defaults
- **WHEN** config has no `cors` field
- **THEN** the server SHALL allow only the dashboard's own loopback origins (listener ports) plus same-origin


### Requirement: Trusted-network origins allowed for LAN-to-LAN switching
The server SHALL CORS-allow a cross-origin request whose `Origin` host matches any entry in `config.resolvedTrustedNetworks` (exact IP, CIDR, or wildcard, via the same matcher used by the network guard), in addition to the existing loopback, live-tunnel, neutral-shell, and configured-origin allowances. This lets a dashboard served on a trusted LAN host probe and switch to another dashboard on the same trusted network. CORS (who may READ a response) remains distinct from auth (bearer/ticket). An `Origin` whose host is `localhost`, `127.0.0.1` or `[::1]` is decided only by the listener-port rule; a trusted-network match never admits it.

#### Scenario: LAN origin in a trusted network is allowed
- **WHEN** `config.trustedNetworks` contains `192.168.16.0/24`
- **AND** a request arrives with `Origin: http://192.168.16.242:8000`
- **THEN** the server SHALL respond with `Access-Control-Allow-Origin: http://192.168.16.242:8000`

#### Scenario: LAN origin not in any trusted network is rejected
- **WHEN** `config.trustedNetworks` is empty or does not match the origin host
- **AND** a request arrives with `Origin: http://192.168.16.242:8000`
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header (unknown-origin fallthrough, `cb(null, false)`)

#### Scenario: null origin still refused regardless of trusted networks
- **WHEN** a request arrives with `Origin: null`
- **AND** `config.trustedNetworks` is permissive (e.g. `0.0.0.0/0`)
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header (the intentional opaque-origin refusal is preserved)

#### Scenario: Empty trusted networks preserves prior behavior
- **WHEN** `config.trustedNetworks` is empty
- **THEN** CORS allowance SHALL consist of loopback on a dashboard listener port, live tunnel origins, the neutral shell, and `cors.allowedOrigins` only

#### Scenario: A trusted-network entry never admits a loopback origin on another port
- **GIVEN** `config.trustedNetworks` contains `127.0.0.1`
- **WHEN** a request arrives with `Origin: http://127.0.0.1:3000` (not a dashboard listener port)
- **THEN** the server SHALL NOT emit an `Access-Control-Allow-Origin` header
