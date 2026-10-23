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

### Requirement: CORS preflight allows mutating methods
The server SHALL advertise `GET, HEAD, POST, PUT, PATCH, DELETE` in `Access-Control-Allow-Methods` (`CORS_ALLOWED_METHODS` in `auth/cors-origin.ts`, passed as `@fastify/cors` `methods`). The `@fastify/cors` v11 default (`GET,HEAD,POST`) SHALL NOT be relied on. The method list SHALL NOT widen which origins are allowed; auth still gates every mutation.

#### Scenario: Cross-origin PUT preflight from an allowed origin
- **WHEN** an allowed cross-origin client (e.g. the Electron renderer) sends `OPTIONS /api/openspec/groups/assignments` with `Access-Control-Request-Method: PUT`
- **THEN** `Access-Control-Allow-Methods` SHALL include `PUT`
- **AND** the follow-up `PUT` SHALL NOT be blocked by the browser

#### Scenario: PATCH and DELETE preflight
- **WHEN** an allowed origin preflights `PATCH` or `DELETE`
- **THEN** `Access-Control-Allow-Methods` SHALL include the requested method

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
origin (alongside the existing loopback and active-tunnel defaults) so the
neutral static shell works without per-server configuration,
while `cors.allowedOrigins` remains available for additional origins.

#### Scenario: Neutral shell allowed without config
- **WHEN** a request comes from `https://pi-dashboard.dev`
- **AND** `cors.allowedOrigins` is empty
- **THEN** the server SHALL respond with `Access-Control-Allow-Origin: https://pi-dashboard.dev`

#### Scenario: CORS distinct from trusted networks
- **WHEN** the neutral shell origin is CORS-allowed
- **THEN** authentication is still enforced by bearer token, not by the origin allowance

### Requirement: Trusted-network origins allowed for LAN-to-LAN switching
The server SHALL CORS-allow a cross-origin request whose `Origin` host matches any entry in `config.resolvedTrustedNetworks` (exact IP, CIDR, or wildcard, via the same matcher used by the network guard), in addition to the existing loopback, live-tunnel, neutral-shell, and configured-origin allowances. This lets a dashboard served on a trusted LAN host probe and switch to another dashboard on the same trusted network. CORS (who may READ a response) remains distinct from auth (bearer/ticket).

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
- **THEN** CORS allowance SHALL consist of loopback, live tunnel origins, the neutral shell, and `cors.allowedOrigins` only

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

The shipped standing allowances — loopback, the neutral shell, `cors.allowedOrigins` and
trusted networks — are untouched. A `*.share.zrok.io` / `*.shares.zrok.io` origin SHALL NOT
be allowed merely because of its host suffix: on the CORS read path it is allowed only while
it is a live tunnel origin. The suffix match SHALL be available only when
`cors.allowZrokWildcard` is explicitly `true`, as a rollback switch. `cors.allowZrokWildcard` is a dashboard configuration key in the `cors` block of the dashboard config file; it is a boolean whose default is `false`, and any value other than the boolean `true` SHALL be treated as `false`.

#### Scenario: Non-primary tunnel origin is allowed
- **GIVEN** zrok is primary and tailscale is also connected
- **WHEN** a request arrives with the tailscale origin
- **THEN** CORS SHALL allow it

#### Scenario: Primary tunnel origin is allowed
- **WHEN** a request arrives with the primary provider's origin
- **THEN** CORS SHALL allow it, as before this change

#### Scenario: Disconnected provider's origin is no longer allowed by this rule
- **GIVEN** a provider (tailscale, zerotier, ngrok or zrok) was connected and its origin was allowed
- **WHEN** that provider disconnects and a request arrives with its origin
- **THEN** CORS SHALL NOT allow it on the strength of a stale tunnel

#### Scenario: A non-live zrok share origin is denied by default
- **GIVEN** the active zrok tunnel is `https://abc.shares.zrok.io`
- **AND** `cors.allowZrokWildcard` is unset
- **WHEN** a request arrives with `Origin: https://other.share.zrok.io`
- **THEN** CORS SHALL NOT emit an `Access-Control-Allow-Origin` header for it
- **AND** the refusal SHALL be recorded as any other refused CORS origin

#### Scenario: The zrok wildcard is unchanged by this requirement
- **GIVEN** a zrok tunnel was connected and has since disconnected
- **WHEN** a request arrives from that tunnel's former `*.shares.zrok.io` origin
- **THEN** CORS SHALL NOT allow it
- **AND** the host suffix alone SHALL NOT admit it

#### Scenario: The live zrok tunnel origin remains allowed
- **GIVEN** a zrok tunnel is connected
- **WHEN** a request arrives with that tunnel's origin
- **THEN** CORS SHALL allow it, including after the tunnel URL rotates to a new host

#### Scenario: Opt-in config restores the zrok host-suffix allowance
- **GIVEN** the dashboard config sets `cors.allowZrokWildcard` to `true`
- **WHEN** a request arrives from any `*.share.zrok.io` or `*.shares.zrok.io` origin
- **THEN** CORS SHALL allow it

#### Scenario: Opt-in wildcard matches canonical variants
- **GIVEN** the dashboard config sets `cors.allowZrokWildcard` to `true`
- **WHEN** a request arrives with `Origin: https://abc.share.zrok.io:443` or `Origin: HTTPS://ABC.Share.Zrok.IO.`
- **THEN** CORS SHALL allow it, the same canonical form as for a live tunnel origin

#### Scenario: Wildcard setting reloads like allowedOrigins
- **WHEN** `cors.allowZrokWildcard` is changed in config
- **THEN** the change SHALL take effect under the same reload semantics as a change to `cors.allowedOrigins`

#### Scenario: Non-boolean wildcard setting stays off
- **GIVEN** the dashboard config sets `cors.allowZrokWildcard` to a value other than boolean `true`
- **WHEN** a request arrives from a non-live `*.share.zrok.io` origin
- **THEN** CORS SHALL NOT allow it

#### Scenario: Unrelated origins still rejected
- **WHEN** a request arrives with an origin matching no connected tunnel, no configured origin and no trusted network
- **THEN** CORS SHALL reject it

#### Scenario: Widening CORS does not widen the auth origin
- **GIVEN** several tunnels are connected and all their origins are CORS-allowed
- **WHEN** an OAuth redirect URI is minted
- **THEN** it SHALL still derive only from the primary provider's URL

### Requirement: A refused CORS origin is observable

A CORS origin refusal SHALL be recorded in the denial ledger so it is visible to a trusted client, rather than surfacing only as an opaque browser-side failure with no server-side trace.

#### Scenario: Refused origin is recorded

- **WHEN** an origin is refused by the CORS decision
- **THEN** a ledger entry SHALL record the refusal with the refused origin

#### Scenario: Recording does not alter the CORS decision

- **WHEN** a refusal is recorded
- **THEN** the CORS response SHALL be unchanged
- **AND** allowed origins SHALL be unaffected

### Requirement: Allowed CORS origins are reviewable and revocable

Configured CORS origins SHALL be listed in `Settings → Access` with a revoke action that removes them through the existing configuration write path. Origins that are allowed structurally rather than by configuration — loopback, the active tunnel URL, and the neutral shell origin — SHALL be shown as non-revocable rather than offered a revoke action that could not take effect.

#### Scenario: Configured origins are listed and revocable

- **WHEN** the Access page is opened and CORS origins are configured
- **THEN** each configured origin SHALL be listed with a revoke action

#### Scenario: Structural allowances are shown as non-revocable

- **WHEN** an origin is allowed because it is loopback, the active tunnel URL, or the neutral shell origin
- **THEN** it SHALL be presented without a revoke action

### Requirement: An origin denial may be answered by prompt

A recorded CORS origin denial MAY raise a dialog naming the denied origin, so the
operator can admit it without first having to diagnose an opaque browser failure.
An allow-always verdict SHALL add the origin to the configured allowed origins.
The denied request SHALL NOT be suspended.

The origin SHALL be displayed exactly as received, escaped for display, so a
crafted origin string cannot misrepresent itself in the dialog.

#### Scenario: Allow always admits the origin

- **WHEN** an operator answers allow-always on an origin denial
- **THEN** the origin SHALL be added to the configured allowed origins
- **AND** a subsequent request from it SHALL be admitted

#### Scenario: The origin is rendered safely

- **WHEN** a dialog displays a denied origin
- **THEN** the value SHALL be escaped and SHALL NOT be interpreted as markup

#### Scenario: The wildcard admission path is not widened

- **WHEN** a verdict admits an origin
- **THEN** exactly that origin SHALL be added
- **AND** no wildcard or pattern SHALL be created from it

### Requirement: Tunnel origins compare in canonical form
The server SHALL compare a request `Origin` against live tunnel origins, and a same-origin check against the request host, in canonical form: scheme and host case-insensitive, an explicit default port (`:443` for https, `:80` for http) equal to no port, and a trailing dot on the host equal to the dotless host.

#### Scenario: Case-insensitive scheme and host
- **GIVEN** the live tunnel origin is `https://abc.shares.zrok.io`
- **WHEN** a request arrives with `Origin: HTTPS://ABC.Shares.Zrok.IO`
- **THEN** CORS SHALL allow it

#### Scenario: Default port elided
- **GIVEN** the live tunnel origin is `https://abc.shares.zrok.io`
- **WHEN** a request arrives with `Origin: https://abc.shares.zrok.io:443`
- **THEN** CORS SHALL allow it

#### Scenario: Tunnel URL recorded with an explicit default port
- **GIVEN** the live tunnel URL was captured as `https://abc.shares.zrok.io:443/`
- **WHEN** a request arrives with `Origin: https://abc.shares.zrok.io`
- **THEN** CORS SHALL allow it

#### Scenario: Trailing-dot host equals the dotless host
- **GIVEN** the live tunnel origin is `https://abc.shares.zrok.io`
- **WHEN** a request arrives with `Origin: https://abc.shares.zrok.io.`
- **THEN** CORS SHALL allow it

#### Scenario: Non-default port is a different origin
- **GIVEN** the live tunnel origin is `https://abc.shares.zrok.io`
- **WHEN** a request arrives with `Origin: https://abc.shares.zrok.io:8443`
- **THEN** CORS SHALL NOT allow it

#### Scenario: Different scheme is a different origin
- **GIVEN** the live tunnel origin is `https://abc.shares.zrok.io`
- **WHEN** a request arrives with `Origin: http://abc.shares.zrok.io`
- **THEN** CORS SHALL NOT allow it
