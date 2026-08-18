# server-cors Specification Delta

## ADDED Requirements

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
