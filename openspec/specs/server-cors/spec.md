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

### Requirement: Every live tunnel origin is an allowed CORS origin
The CORS allow-decision compares a request `Origin` against the active tunnel URL. With
several providers connected concurrently, the browser may load the dashboard from any of
them, so the decision SHALL allow the origin of **every** currently-connected tunnel, not
only the primary's.

This is deliberately wider than the OAuth redirect base, which stays bound to the primary
alone. The two answer different questions: CORS is read-authority for an origin already in
the address bar, while the redirect base mints a URI and pins the session-cookie origin.
Widening CORS therefore does not weaken the single-origin auth invariant.

An origin SHALL be allowed only while its tunnel is connected; a disconnected provider's
origin SHALL stop being allowed **by this requirement**.

This requirement adds allowances; it removes none. The shipped standing allowances —
loopback, the neutral shell, `cors.allowedOrigins`, trusted networks, and the blanket
`*.share.zrok.io` / `*.shares.zrok.io` host match — are untouched. A zrok origin therefore
remains allowed by that pre-existing wildcard after its tunnel disconnects; that is
existing specified behaviour ("Empty trusted networks preserves prior behavior — allowance
SHALL be identical to before"), not a consequence of this change, and narrowing it is out
of scope here. The connected-only rule is observable for providers that have no standing
wildcard: tailscale, zerotier and ngrok.

#### Scenario: Non-primary tunnel origin is allowed
- **GIVEN** zrok is primary and tailscale is also connected
- **WHEN** a request arrives with the tailscale origin
- **THEN** CORS SHALL allow it

#### Scenario: Primary tunnel origin is allowed
- **WHEN** a request arrives with the primary provider's origin
- **THEN** CORS SHALL allow it, as before this change

#### Scenario: Disconnected provider's origin is no longer allowed by this rule
- **GIVEN** a provider with no standing wildcard allowance (tailscale, zerotier or ngrok) was connected and its origin was allowed
- **WHEN** that provider disconnects and a request arrives with its origin
- **THEN** CORS SHALL NOT allow it on the strength of a stale tunnel

#### Scenario: The zrok wildcard is unchanged by this requirement
- **GIVEN** a zrok tunnel was connected and has since disconnected
- **WHEN** a request arrives from a `*.shares.zrok.io` origin
- **THEN** CORS SHALL still allow it via the pre-existing host-suffix allowance
- **AND** this change SHALL NOT narrow that allowance

#### Scenario: Unrelated origins still rejected
- **WHEN** a request arrives with an origin matching no connected tunnel, no configured origin and no trusted network
- **THEN** CORS SHALL reject it

#### Scenario: Widening CORS does not widen the auth origin
- **GIVEN** several tunnels are connected and all their origins are CORS-allowed
- **WHEN** an OAuth redirect URI is minted
- **THEN** it SHALL still derive only from the primary provider's URL

