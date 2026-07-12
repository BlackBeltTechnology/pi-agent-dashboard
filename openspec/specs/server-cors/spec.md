## Purpose

Configure cross-origin resource sharing so separately-hosted clients (loopback, the active tunnel, `*.share.zrok.io`, the neutral shell, and configured origins) can call the dashboard server, while authentication stays enforced independently.
## Requirements
### Requirement: CORS enabled on dashboard server
The server SHALL register `@fastify/cors` to handle cross-origin requests from separately-hosted clients.

#### Scenario: Same-origin requests pass through
- **WHEN** a request has no `Origin` header (same-origin)
- **THEN** the server SHALL process it normally without CORS headers

#### Scenario: Localhost origins allowed by default
- **WHEN** a request comes from `http://localhost:3000` or `http://127.0.0.1:5173` or any localhost port
- **THEN** the server SHALL respond with `Access-Control-Allow-Origin` matching the request origin

#### Scenario: Configured origins allowed
- **WHEN** `cors.allowedOrigins` in config contains `https://dashboard.example.com`
- **AND** a request comes from `https://dashboard.example.com`
- **THEN** the server SHALL respond with matching `Access-Control-Allow-Origin`

#### Scenario: Unknown origins rejected
- **WHEN** a request comes from `https://evil.example.com` not in config
- **THEN** the server SHALL reject the CORS preflight

### Requirement: CORS credentials support
The server SHALL set `Access-Control-Allow-Credentials: true` to support cross-origin auth cookies.

#### Scenario: Cross-origin auth cookies forwarded
- **WHEN** a cross-origin request includes credentials (cookies)
- **THEN** the server SHALL accept and process the cookies

### Requirement: CORS config field
The dashboard config (`~/.pi/dashboard/config.json`) SHALL support a `cors` object with an `allowedOrigins` string array.

#### Scenario: Config with allowed origins
- **WHEN** config contains `{ "cors": { "allowedOrigins": ["https://ui.example.com"] } }`
- **THEN** the server SHALL allow requests from `https://ui.example.com`

#### Scenario: No cors config uses defaults
- **WHEN** config has no `cors` field
- **THEN** the server SHALL allow only localhost origins (plus same-origin)

### Requirement: Neutral shell origin trusted by default
The server SHALL treat `https://pi-dashboard.dev` as a built-in allowed CORS
origin (alongside the existing loopback, active-tunnel, and `*.share.zrok.io`
defaults) so the neutral static shell works without per-server configuration,
while `cors.allowedOrigins` remains available for additional origins.

#### Scenario: Neutral shell allowed without config
- **WHEN** a request comes from `https://pi-dashboard.dev`
- **AND** `cors.allowedOrigins` is empty
- **THEN** the server SHALL respond with `Access-Control-Allow-Origin: https://pi-dashboard.dev`

#### Scenario: CORS distinct from trusted networks
- **WHEN** the neutral shell origin is CORS-allowed
- **THEN** authentication is still enforced by bearer token, not by the origin allowance

### Requirement: Trusted-network origins allowed for LAN-to-LAN switching
The server SHALL CORS-allow a cross-origin request whose `Origin` host matches any entry in `config.resolvedTrustedNetworks` (exact IP, CIDR, or wildcard, via the same matcher used by the network guard), in addition to the existing loopback, active-tunnel, `*.share.zrok.io`, neutral-shell, and configured-origin allowances. This lets a dashboard served on a trusted LAN host probe and switch to another dashboard on the same trusted network. CORS (who may READ a response) remains distinct from auth (bearer/ticket).

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
- **THEN** CORS allowance SHALL be identical to before this change (loopback, active tunnel, `*.share.zrok.io`, neutral shell, and `cors.allowedOrigins` only)

