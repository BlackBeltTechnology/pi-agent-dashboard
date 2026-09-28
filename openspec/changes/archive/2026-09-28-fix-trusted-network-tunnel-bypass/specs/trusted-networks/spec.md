## ADDED Requirements

### Requirement: Relayed loopback requests are never trusted by network entry
Every decision that admits or exempts a request because its source IP matches `trustedNetworks` / `auth.bypassHosts` SHALL go through a single predicate `isTrustedSource(ip, headers, trusted)` exported from `localhost-guard.ts`. The predicate SHALL return `false` when the socket peer is in the loopback range — any address in `127.0.0.0/8`, `::1`, or IPv4-mapped `::ffff:127.0.0.0/104` (not only the literal `127.0.0.1`) — **and** the request carries any proxy-forwarding header (the core `PROXY_FORWARDING_HEADERS` list used by `isGenuinelyLocal`), regardless of the trusted entries. Otherwise it SHALL return the result of `isBypassedHost(ip, trusted)`.

This applies to: the HTTP network guard and universal hook, the OAuth `onRequest` bypass-host skip, the WebSocket upgrade with auth configured, the WebSocket upgrade with auth not configured, and the device-tier exemption.

#### Scenario: Tunnel request with loopback trusted entry is denied
- **GIVEN** `trustedNetworks: ["127.0.0.1"]`, auth not configured
- **WHEN** `GET /api/sessions` arrives from peer `127.0.0.1` carrying `X-Forwarded-For: 203.0.113.9`
- **THEN** the response SHALL be 403 with `error: "network_not_allowed"`

#### Scenario: Tunnel request with loopback CIDR or wildcard entry is denied
- **GIVEN** `trustedNetworks` contains `127.0.0.0/8` or `127.*`
- **WHEN** a request arrives from peer `127.0.0.1` carrying `X-Forwarded-Proto: https`
- **THEN** the trusted-network pass condition SHALL NOT admit it

#### Scenario: Relay on a non-canonical loopback address is denied
- **GIVEN** `trustedNetworks` contains `127.0.0.0/8`
- **WHEN** a request arrives from peer `127.0.0.5` (or `::ffff:127.0.0.5`) carrying `X-Forwarded-For`
- **THEN** the trusted-network pass condition SHALL NOT admit it

#### Scenario: OAuth bypass-host skip does not apply to relayed loopback
- **GIVEN** auth is configured and `auth.bypassHosts` contains `127.0.0.1`
- **WHEN** a request arrives from peer `127.0.0.1` carrying `X-Forwarded-For` and no valid session cookie
- **THEN** the auth hook SHALL NOT skip authentication

#### Scenario: WebSocket upgrade through a tunnel is not trusted by loopback entry
- **GIVEN** `trustedNetworks: ["127.0.0.1"]`
- **WHEN** a `/ws` upgrade arrives from peer `127.0.0.1` with `X-Forwarded-For` and no valid ticket or cookie
- **THEN** the upgrade SHALL be rejected (401 when auth is configured, 403 otherwise)

#### Scenario: Paired device over a tunnel still works
- **GIVEN** `trustedNetworks: ["127.0.0.1"]`
- **WHEN** a request arrives from peer `127.0.0.1` with `X-Forwarded-For` and a valid device bearer
- **THEN** the request SHALL be admitted via `isAuthenticated` and device-tier checks SHALL apply (no trusted-network tier exemption)

#### Scenario: Genuine local request unaffected
- **WHEN** a request arrives from peer `127.0.0.1` with no forwarding header
- **THEN** it SHALL be admitted by the genuine-local condition, independent of `trustedNetworks`

#### Scenario: LAN trusted CIDR unaffected
- **GIVEN** `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a request arrives from peer `192.168.16.20`, with or without forwarding headers
- **THEN** the trusted-network pass condition SHALL admit it

### Requirement: Loopback trusted entries are reported as inert
When the resolved trusted list (`trustedNetworks` merged with `auth.bypassHosts`) contains entries matching a loopback probe (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), the server SHALL log one `[trusted-networks]` warning naming each such entry and stating it is ignored for tunnel-relayed requests. The warning SHALL be deduplicated by the set of loopback-covering entries, not by the config file stamp, and SHALL NOT be recomputed while the resolved trusted-list array is unchanged (per-request cost on a snapshot cache hit is a reference compare). `/api/health` SHALL include an additive field `trustPosture: { trustedHasLoopback: boolean } | null`, non-null only when `canDiscloseAccessPosture(request)` is true.

#### Scenario: Warning on load
- **WHEN** the server resolves a trusted list containing `"127.0.0.1"`
- **THEN** it SHALL log a single `[trusted-networks]` warning naming `127.0.0.1`

#### Scenario: Unrelated config write does not re-warn
- **GIVEN** the warning for `"127.0.0.1"` was logged
- **WHEN** an unrelated config field is written and the snapshot reparses with the same trusted list
- **THEN** no further `[trusted-networks]` warning SHALL be logged

#### Scenario: Health flag gated by disclosure
- **GIVEN** the trusted list contains a loopback entry
- **WHEN** a genuine-local caller requests `/api/health`
- **THEN** the response SHALL include `trustPosture: { trustedHasLoopback: true }`
- **AND** an unauthenticated non-local caller SHALL receive `trustPosture: null`

### Requirement: Relayed-loopback denials raise no network grant prompt
When the network guard denies a request whose peer is in the loopback range and which carries a proxy-forwarding header, it SHALL still record the block event (marked non-trustable) but SHALL NOT notify the network-denial observer, so no network-plane grant prompt offering to trust the loopback address is raised.

#### Scenario: Tunnel denial does not prompt to trust loopback
- **GIVEN** grant prompting is enabled and an operator channel is connected
- **WHEN** a request from peer `127.0.0.1` carrying `X-Forwarded-For` is denied by the network guard
- **THEN** no network-plane grant prompt SHALL be raised
- **AND** the block event SHALL be recorded with `trustable: false`

#### Scenario: LAN denial still prompts
- **GIVEN** grant prompting is enabled and an operator channel is connected
- **WHEN** a request from untrusted peer `192.168.16.30` is denied
- **THEN** the network-denial observer SHALL be notified as today

## MODIFIED Requirements

### Requirement: Network guard factory
The `localhost-guard` module SHALL export a `createNetworkGuard(trustedNetworks: string[] | (() => string[]))` function that returns a Fastify preHandler. The returned handler SHALL allow requests that satisfy any of: (a) genuinely local — loopback peer (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) **and** no proxy-forwarding header, (b) a valid local-IPC token, (c) `isTrustedSource(ip, headers, trustedNetworks)` is `true`, or (d) `request.isAuthenticated` is `true` (set by the auth `onRequest` hook).

All other requests SHALL receive a **403 with a self-describing JSON body** of the shape `{ success: false, error: "network_not_allowed", reason: string, hint: string }`:
- `error` SHALL be the machine-readable literal `"network_not_allowed"` (replacing the prior human string `"Access denied"`), so clients can branch on policy-denial vs transport failure.
- `reason` SHALL describe the cause (e.g. `"source IP not loopback, not in trustedNetworks, and request not authenticated"`).
- `hint` SHALL describe the remedy (e.g. `"Add this network to trustedNetworks (Settings → Servers) or sign in."`).

The existing `localhostGuard` export SHALL be preserved for backward compatibility.

#### Scenario: Loopback IP allowed
- **WHEN** a request arrives from `127.0.0.1` with no proxy-forwarding header
- **THEN** the guard SHALL allow the request regardless of trustedNetworks or authentication

#### Scenario: Relayed loopback not allowed by loopback alone
- **WHEN** a request arrives from `127.0.0.1` carrying `X-Forwarded-For`, is not authenticated, and carries no local-IPC token
- **THEN** the guard SHALL return 403 `network_not_allowed` even if `trustedNetworks` contains a loopback entry

#### Scenario: Denied request body is self-describing
- **WHEN** `trustedNetworks` is empty, `request.isAuthenticated` is `false`, and a request arrives from `192.168.1.5`
- **THEN** the guard SHALL return 403
- **AND** the response body SHALL be `{ success: false, error: "network_not_allowed", reason, hint }` where `error` is exactly `"network_not_allowed"`
- **AND** `hint` SHALL name the remedy (add to `trustedNetworks` or authenticate)

#### Scenario: Authenticated request allowed
- **WHEN** `request.isAuthenticated` is `true`
- **THEN** the guard SHALL allow the request and SHALL NOT emit the `network_not_allowed` body

### Requirement: WebSocket upgrade respects trusted networks
The WebSocket upgrade handler in `server.ts` SHALL check trusted networks in addition to genuine-local, local-IPC token, ticket and auth. A connection SHALL be allowed without authentication when `isTrustedSource(remoteAddress, headers, trustedNetworks)` is `true`. The `validateWsUpgrade` function SHALL accept the trusted networks list and the upgrade headers and SHALL use `isTrustedSource`.

#### Scenario: WebSocket from trusted network without auth
- **WHEN** a WebSocket upgrade arrives from `192.168.1.42` with `trustedNetworks: ["192.168.1.0/24"]` and no auth cookie
- **THEN** the upgrade SHALL proceed

#### Scenario: WebSocket from untrusted IP without auth
- **WHEN** a WebSocket upgrade arrives from `203.0.113.5` with no auth cookie and auth is configured
- **THEN** the upgrade SHALL be rejected with 401

#### Scenario: WebSocket relayed through a loopback tunnel
- **WHEN** a WebSocket upgrade arrives from `127.0.0.1` with `X-Forwarded-For`, no ticket and no auth cookie, and `trustedNetworks` contains `127.0.0.1`
- **THEN** the upgrade SHALL be rejected

### Requirement: Auth plugin reads merged trusted networks
The auth plugin `onRequest` hook SHALL skip authentication for requests for which `isTrustedSource(request.ip, request.headers, resolvedTrustedNetworks)` is `true` (the merged list). A loopback-range peer carrying a proxy-forwarding header SHALL NOT skip authentication.

#### Scenario: Auth bypassed for trusted network IP
- **WHEN** auth is configured and a request arrives from an IP in `resolvedTrustedNetworks` without being a relayed loopback request
- **THEN** the auth hook SHALL skip authentication for that request

#### Scenario: Auth not bypassed for relayed loopback
- **WHEN** auth is configured, `resolvedTrustedNetworks` contains `127.0.0.1`, and a request arrives from `127.0.0.1` with `X-Forwarded-For`
- **THEN** the auth hook SHALL require authentication
