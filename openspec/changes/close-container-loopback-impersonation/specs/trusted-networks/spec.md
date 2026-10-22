## MODIFIED Requirements

### Requirement: Network guard factory
The `localhost-guard` module SHALL export a `createNetworkGuard(trustedNetworks: string[] | (() => string[]))` function that returns a Fastify preHandler. The returned handler SHALL allow requests that satisfy any of: (a) genuinely local — loopback peer (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) **and** no proxy-forwarding header, (b) a valid local-IPC token, (c) `request.isAuthenticated` is `true` (set by the auth `onRequest` hooks), or (d) **only when the effective trust mode is `"legacy"`**, `isTrustedSource(ip, headers, trustedNetworks)` is `true`. Condition (c) SHALL be evaluated before (d).

All other requests SHALL receive a **403 with a self-describing JSON body** of the shape `{ success: false, error: "network_not_allowed", reason: string, hint: string }`:
- `error` SHALL be the machine-readable literal `"network_not_allowed"`, so clients can branch on policy-denial vs transport failure.
- `reason` SHALL describe the cause (e.g. `"source IP not loopback and request not authenticated"`).
- `hint` SHALL describe the remedy: pairing this device (Request access) or signing in. It SHALL be identical in both trust modes (the body is sent to credential-less callers and SHALL NOT disclose the mode) and SHALL NOT suggest adding the network to a trusted list.

The existing `localhostGuard` export SHALL be preserved for backward compatibility.

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: Loopback IP allowed
- **WHEN** `requireLocalProof` is disabled and a request arrives from `127.0.0.1` with no proxy-forwarding header
- **THEN** the guard SHALL allow the request regardless of trustedNetworks, trust mode or authentication

#### Scenario: Relayed loopback not allowed by loopback alone
- **WHEN** a request arrives from `127.0.0.1` carrying `X-Forwarded-For`, is not authenticated, and carries no local-IPC token
- **THEN** the guard SHALL return 403 `network_not_allowed` even if `trustedNetworks` contains a loopback entry

#### Scenario: Denied request body is self-describing
- **WHEN** `trustedNetworks` is empty, `request.isAuthenticated` is `false`, and a request arrives from `192.168.1.5`
- **THEN** the guard SHALL return 403
- **AND** the response body SHALL be `{ success: false, error: "network_not_allowed", reason, hint }` where `error` is exactly `"network_not_allowed"`
- **AND** `hint` SHALL name the remedy (pair this device or sign in)

#### Scenario: Hint does not disclose the mode
- **WHEN** the guard denies the same request once in `"pair"` mode and once in `"legacy"` mode
- **THEN** both bodies SHALL be identical
- **AND** neither `hint` SHALL mention adding the network to `trustedNetworks`

#### Scenario: Authenticated request allowed
- **WHEN** `request.isAuthenticated` is `true`
- **THEN** the guard SHALL allow the request and SHALL NOT emit the `network_not_allowed` body

### Requirement: WebSocket upgrade respects trusted networks
The WebSocket upgrade handler in `server.ts` SHALL check genuine-local, local-IPC token, ticket and auth, and — **only when the effective trust mode is `"legacy"`** — trusted networks. When the identity floor requires a principal-bearing ticket for the upgrade's scope, that rule SHALL take precedence over every allowance in this requirement, in both modes. In `"legacy"` mode a connection SHALL be allowed without authentication when `isTrustedSource(remoteAddress, headers, trustedNetworks)` is `true`; credential checks (ticket, cookie) SHALL be evaluated before this network match. The `validateWsUpgrade` function SHALL accept the admission list and the upgrade headers and SHALL use `isTrustedSource`.

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: WebSocket from trusted network without auth
- **WHEN** the identity floor is not enforced, the effective trust mode is `"legacy"`, and a WebSocket upgrade arrives from `192.168.1.42` with `trustedNetworks: ["192.168.1.0/24"]` and no auth cookie
- **THEN** the upgrade SHALL proceed

#### Scenario: WebSocket from listed network without auth in pair mode
- **WHEN** the effective trust mode is `"pair"` and a WebSocket upgrade arrives from `192.168.1.42` with `trustedNetworks: ["192.168.1.0/24"]`, no ticket and no auth cookie
- **THEN** the upgrade SHALL be rejected

#### Scenario: WebSocket from untrusted IP without auth
- **WHEN** a WebSocket upgrade arrives from `203.0.113.5` with no auth cookie and auth is configured
- **THEN** the upgrade SHALL be rejected with 401

#### Scenario: WebSocket relayed through a loopback tunnel
- **WHEN** a WebSocket upgrade arrives from `127.0.0.1` with `X-Forwarded-For`, no ticket and no auth cookie, and `trustedNetworks` contains `127.0.0.1`
- **THEN** the upgrade SHALL be rejected

### Requirement: WebSocket upgrade admits bypassHosts trust without OAuth
**Only when the effective trust mode is `"legacy"`**, the WebSocket upgrade handler in `server.ts` SHALL admit a connection from an IP matching `resolvedTrustedNetworks` regardless of whether OAuth is configured. When `config.authConfig` is absent or its resolved provider registry is empty and the mode is `"legacy"`, the upgrade SHALL NOT require a JWT cookie; the IP match alone SHALL be sufficient to proceed. In `"pair"` mode the IP match SHALL NOT be sufficient.

When `requireLocalProof` is in effect (the default: absent or `true`), `isTrustedSource` SHALL additionally return `false` for a loopback-range peer that presents no local proof (local token, local credential proof, or local-proof cookie), as specified by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: WebSocket upgrade from bypassHosts-only trusted network
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` (effective mode `"legacy"`) and a WebSocket upgrade request arrives from `192.168.1.42` with no auth cookie
- **THEN** the upgrade SHALL proceed (101 Switching Protocols)
- **AND** the connection SHALL NOT be rejected with 403 or 401

#### Scenario: WebSocket upgrade from listed network in pair mode
- **WHEN** config is `{ "network": { "trustMode": "pair" }, "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `192.168.1.42` with no ticket and no auth cookie
- **THEN** the upgrade SHALL be rejected with 403

#### Scenario: WebSocket upgrade from untrusted IP in bypassHosts-only config
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `10.0.0.5` (not in trusted list)
- **THEN** the upgrade SHALL be rejected with 403

### Requirement: Universal guard runs regardless of auth configuration
The universal `onRequest` guard SHALL enforce network policy on in-jurisdiction
routes even when auth is not configured. When `config.authConfig` is absent or its
provider registry is empty, `request.isAuthenticated` SHALL default to `false`
(decorated unconditionally) and the guard SHALL still deny non-loopback,
non-trusted, non-exception in-jurisdiction requests. Enforcement SHALL NOT depend
on the conditional OAuth `onRequest` hook being registered.

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: plugin route denied over tunnel with auth off
- **WHEN** auth is not configured and a proxied/tunneled request (forwarding headers present, so not genuine-local) arrives at `POST /api/plugins/automation/create` from an untrusted IP
- **THEN** the guard SHALL deny the request with 403, write no automation file, and spawn no agent

#### Scenario: provider-auth route denied with auth off
- **WHEN** auth is not configured and an untrusted, unauthenticated request arrives at `PUT /api/provider-auth/api-key`
- **THEN** the guard SHALL deny the request with 403

#### Scenario: loopback allowed with auth off
- **WHEN** `requireLocalProof` is disabled and auth is not configured and a genuine-local loopback request arrives at a guarded route
- **THEN** the guard SHALL allow the request

### Requirement: Relayed loopback requests are never trusted by network entry
Every decision that admits or exempts a request because its source IP matches `trustedNetworks` / `auth.bypassHosts` SHALL go through a single predicate `isTrustedSource(ip, headers, trusted)` exported from `localhost-guard.ts`. The predicate SHALL return `false` when the socket peer is in the loopback range — any address in `127.0.0.0/8`, `::1`, or IPv4-mapped `::ffff:127.0.0.0/104` (not only the literal `127.0.0.1`) — **and** the request carries any proxy-forwarding header (the core `PROXY_FORWARDING_HEADERS` list used by `isGenuinelyLocal`), regardless of the trusted entries. Otherwise it SHALL return the result of `isBypassedHost(ip, trusted)`.

This applies to: the HTTP network guard and universal hook, the OAuth `onRequest` bypass-host skip, the WebSocket upgrade with auth configured, the WebSocket upgrade with auth not configured, and the device-tier exemption. At each of these admission sites the `trusted` argument SHALL be the mode-dependent admission list (empty in `"pair"` mode), per "Network match does not authenticate in pair mode".

When `requireLocalProof` is in effect (the default: absent or `true`), `isTrustedSource` SHALL additionally return `false` for a loopback-range peer that presents no local proof (local token, local credential proof, or local-proof cookie), as specified by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

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
- **WHEN** `requireLocalProof` is disabled and a request arrives from peer `127.0.0.1` with no forwarding header
- **THEN** it SHALL be admitted by the genuine-local condition, independent of `trustedNetworks`

#### Scenario: LAN trusted CIDR unaffected
- **GIVEN** `trustedNetworks: ["192.168.16.0/24"]` and effective trust mode `"legacy"`
- **WHEN** a request arrives from peer `192.168.16.20`, with or without forwarding headers
- **THEN** the trusted-network pass condition SHALL admit it

#### Scenario: LAN trusted CIDR does not admit in pair mode
- **GIVEN** `trustedNetworks: ["192.168.16.0/24"]` and effective trust mode `"pair"`
- **WHEN** an unauthenticated request arrives from peer `192.168.16.20`
- **THEN** no trusted-network pass condition SHALL admit it
