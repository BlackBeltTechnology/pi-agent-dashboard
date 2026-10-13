## ADDED Requirements

### Requirement: Previews authenticate through a per-preview capability path
Because the preview frame has an opaque origin, its subresource, fetch and WebSocket requests carry no dashboard cookie. The server SHALL therefore offer a **capability path** for each live-server target:

- **Mint.** `POST /api/live-server/:id/capability` SHALL return `{ path: "/live/<id>/~c/<token>/", expiresAt }` for a caller that passes the existing admission rules and holds at least the `control` tier; an unknown `id` SHALL return 404. The token SHALL be at least 128 bits of randomness, stored server-side only as a hash, and bound to that target id and to the minting principal (device id, login session, or local caller).
- **Accept.** An HTTP request (any method) or a `live`-scope WebSocket upgrade whose raw pathname begins with exactly the segments `live`, `<id>`, `~c`, `<token>` followed by `/` — compared segment by segment on the raw (not dot-resolved) pathname, with no dot-segment and no percent-encoded `/`, `~` or `.` anywhere in it — and whose token is valid for that same `<id>` SHALL be admitted as authenticated, carrying the minting principal's identity and tier. The token SHALL authorize nothing else — no other target id and no path outside `/live/<id>/~c/<token>/`. On a WebSocket upgrade the token is read from the same path segment (never a query parameter or subprotocol). When the identity floor requires a principal-bearing credential for the `live` scope, a capability SHALL satisfy it only if it was minted by an identity principal.
- **Lifetime.** A token SHALL expire after 30 minutes without an accepted request and in any case 12 hours after minting, and SHALL be invalidated when its target is removed, its minting device is revoked, its minting session ends, or the server restarts. Each accepted request SHALL extend the idle expiry.
- **Refusal.** A missing, unknown, expired or wrong-target token SHALL be refused by the normal admission rules (no credential) and SHALL NOT be distinguishable from an unknown token to the caller.
- **Forwarding.** The proxy SHALL remove the `/~c/<token>` segment from the forwarded path and from a forwarded `Referer` header, SHALL rewrite upstream redirects into the capability prefix, and SHALL add `Referrer-Policy: no-referrer` to proxied responses that set no referrer policy. Server logs SHALL redact the token.

`expiresAt` SHALL be the token's absolute expiry. The viewer SHALL mint a capability before framing a target and frame the returned path; it SHALL mint a fresh one, and re-point the frame to it, on every reopen of the target and 10 minutes before `expiresAt`. Existing `/live/<id>/` admission (genuine local, `legacy` network trust, OAuth session) is unchanged.

#### Scenario: Paired LAN browser previews with HMR in pair mode
- **GIVEN** effective trust mode `"pair"` and a browser on `192.168.16.20` holding a `control`-tier device cookie
- **WHEN** the viewer mints a capability for target `vite-5173` and frames the returned path
- **THEN** the page, its scripts and images, its fetches and its HMR WebSocket under that path SHALL all be admitted

#### Scenario: Observe-tier device cannot mint
- **WHEN** a request authenticated by an `observe` device credential calls `POST /api/live-server/vite-5173/capability`
- **THEN** it SHALL be refused with 403 `insufficient_scope` and no token SHALL be created

#### Scenario: Token is bound to one target
- **GIVEN** a valid capability for target `vite-5173`
- **WHEN** a request uses that token under `/live/docs-8080/~c/<token>/`
- **THEN** it SHALL NOT be admitted by the capability

#### Scenario: Token never reaches the API
- **WHEN** a request to `/api/sessions` carries a capability token in its path, query or headers
- **THEN** the token SHALL NOT authenticate it

#### Scenario: Mangled capability paths are refused
- **WHEN** a request uses `/live/vite-5173/~c/<token>evil/`, `/live/vite-5173/%7Ec/<token>/`, `/live/vite-5173/x/../~c/<token>/` or `/live/vite-5173/~c/<token>` (no trailing segment separator)
- **THEN** none SHALL be admitted by the capability

#### Scenario: Identity floor accepts only identity-minted capabilities
- **GIVEN** the identity floor is enforced
- **WHEN** a live upgrade presents a capability minted by a paired device without an identity principal
- **THEN** it SHALL be refused
- **AND** a capability minted by an identity principal SHALL be admitted

#### Scenario: Idle expiry
- **GIVEN** a capability unused for 30 minutes
- **WHEN** a request uses it
- **THEN** it SHALL NOT be admitted by the capability

#### Scenario: Viewer re-mints before absolute expiry
- **GIVEN** a framed capability whose `expiresAt` is 12 h after minting
- **WHEN** 11 h 50 min have elapsed with the viewer open
- **THEN** the viewer SHALL have minted a new capability and re-pointed the frame to its path

#### Scenario: Revoking the device kills its previews
- **GIVEN** a capability minted by device A
- **WHEN** device A is revoked
- **THEN** the next request using that capability SHALL NOT be admitted

#### Scenario: Upstream sees the plain path
- **WHEN** `GET /live/vite-5173/~c/<token>/src/main.ts` is proxied
- **THEN** the upstream SHALL receive `GET /src/main.ts`

#### Scenario: Redirect stays inside the capability
- **WHEN** the upstream answers `302 Location: /login`
- **THEN** the browser SHALL receive `Location: /live/vite-5173/~c/<token>/login`

#### Scenario: Token not leaked by referrer or logs
- **WHEN** a proxied page without its own referrer policy links to a third-party site
- **THEN** the response SHALL have carried `Referrer-Policy: no-referrer`
- **AND** no server log line SHALL contain the token

### Requirement: Dashboard credentials never reach the preview upstream
The `/live/*` proxy SHALL remove dashboard credentials from every forwarded HTTP request and WebSocket upgrade: the dashboard login-session cookie (`pi_dash_token`, `Path=/`, sent today) and — as defense in depth against crafted clients — the `pi_dash_device` cookie SHALL be removed from the `Cookie` header (dropping the header only when nothing remains), and an `Authorization` header SHALL be removed when it carries a dashboard device bearer. Every other cookie and header SHALL be forwarded unchanged, so the previewed app keeps its own session. In the other direction, the proxy SHALL drop any upstream `Set-Cookie` that names a dashboard cookie (`pi_dash_` prefix), so a previewed app cannot plant or overwrite a dashboard credential.

#### Scenario: Dashboard cookies stripped, app cookie kept (HTTP)
- **WHEN** a request carrying `pi_dash_device=…; pi_dash_token=…; myapp_session=abc` is proxied
- **THEN** the upstream SHALL receive `Cookie: myapp_session=abc`

#### Scenario: Dashboard cookies stripped on upgrade
- **WHEN** a live WebSocket upgrade carrying the dashboard session cookie is forwarded
- **THEN** the upstream upgrade request SHALL NOT contain it

#### Scenario: Upstream cannot plant a dashboard cookie
- **WHEN** the upstream responds with `Set-Cookie: pi_dash_token=attacker; Path=/` and `Set-Cookie: myapp_session=x`
- **THEN** the browser SHALL receive only the `myapp_session` cookie

#### Scenario: App bearer kept
- **WHEN** a proxied request carries `Authorization: Bearer <app token>` that is not a dashboard device bearer
- **THEN** the upstream SHALL receive it unchanged
