## MODIFIED Requirements

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

## ADDED Requirements

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
