## Purpose
Network access policy for guarded endpoints: an allow-list (CIDR/wildcard/exact) that, with loopback and authenticated requests, governs the network guard.
## Requirements
### Requirement: Top-level trustedNetworks config field
The config module SHALL support a top-level `trustedNetworks` field of type `string[]` in `~/.pi/dashboard/config.json`. Each entry SHALL be an IPv4 CIDR (e.g. `192.168.1.0/24`), wildcard (e.g. `10.0.0.*`), or exact IP address. The default SHALL be an empty array. At load time, the config module SHALL merge `trustedNetworks` with `auth.bypassHosts` (if present) into a single deduplicated list available as `resolvedTrustedNetworks` on the config object.

#### Scenario: trustedNetworks configured without auth
- **WHEN** config contains `{ "trustedNetworks": ["192.168.1.0/24"] }` and no `auth` section
- **THEN** `loadConfig()` SHALL return `trustedNetworks: ["192.168.1.0/24"]` and `resolvedTrustedNetworks: ["192.168.1.0/24"]`

#### Scenario: trustedNetworks merged with auth.bypassHosts
- **WHEN** config contains `{ "trustedNetworks": ["192.168.1.0/24"], "auth": { "bypassHosts": ["10.0.0.0/8"] } }`
- **THEN** `resolvedTrustedNetworks` SHALL contain both `192.168.1.0/24` and `10.0.0.0/8`

#### Scenario: Duplicate entries deduplicated
- **WHEN** both `trustedNetworks` and `auth.bypassHosts` contain `192.168.1.0/24`
- **THEN** `resolvedTrustedNetworks` SHALL contain the entry only once

#### Scenario: Neither configured
- **WHEN** config has no `trustedNetworks` field and no `auth.bypassHosts`
- **THEN** `resolvedTrustedNetworks` SHALL be an empty array

### Requirement: Network guard factory
The `localhost-guard` module SHALL export a `createNetworkGuard(trustedNetworks: string[])` function that returns a Fastify preHandler. The returned handler SHALL allow requests that satisfy any of: (a) loopback address (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), (b) IP matching an entry in `trustedNetworks` (CIDR, wildcard, or exact match), or (c) `request.isAuthenticated` is `true` (set by the auth `onRequest` hook).

All other requests SHALL receive a **403 with a self-describing JSON body** of the shape `{ success: false, error: "network_not_allowed", reason: string, hint: string }`:
- `error` SHALL be the machine-readable literal `"network_not_allowed"` (replacing the prior human string `"Access denied"`), so clients can branch on policy-denial vs transport failure.
- `reason` SHALL describe the cause (e.g. `"source IP not loopback, not in trustedNetworks, and request not authenticated"`).
- `hint` SHALL describe the remedy (e.g. `"Add this network to trustedNetworks (Settings → Servers) or sign in."`).

The existing `localhostGuard` export SHALL be preserved for backward compatibility.

#### Scenario: Loopback IP allowed
- **WHEN** a request arrives from `127.0.0.1`
- **THEN** the guard SHALL allow the request regardless of trustedNetworks or authentication

#### Scenario: Denied request body is self-describing
- **WHEN** `trustedNetworks` is empty, `request.isAuthenticated` is `false`, and a request arrives from `192.168.1.5`
- **THEN** the guard SHALL return 403
- **AND** the response body SHALL be `{ success: false, error: "network_not_allowed", reason, hint }` where `error` is exactly `"network_not_allowed"`
- **AND** `hint` SHALL name the remedy (add to `trustedNetworks` or authenticate)

#### Scenario: Authenticated request allowed
- **WHEN** `request.isAuthenticated` is `true`
- **THEN** the guard SHALL allow the request and SHALL NOT emit the `network_not_allowed` body

### Requirement: Network guard threaded to all protected routes
All route files that currently use `localhostGuard` as a preHandler SHALL receive the network guard via their deps parameter instead of importing `localhostGuard` directly. The `RouteDeps` type SHALL include a `networkGuard` field. The server SHALL create the guard from `resolvedTrustedNetworks` at startup and pass it to all route registrations.

#### Scenario: Session route uses network guard
- **WHEN** a request to `POST /api/sessions/:id/prompt` arrives from a trusted network IP
- **THEN** the route SHALL allow the request (guard passes)

#### Scenario: File route uses network guard
- **WHEN** a request to `GET /api/browse` arrives from an untrusted IP
- **THEN** the route SHALL return 403

### Requirement: WebSocket upgrade respects trusted networks
The WebSocket upgrade handler in `server.ts` SHALL check trusted networks in addition to loopback and auth. A connection from a trusted network IP SHALL be allowed without authentication. The `validateWsUpgrade` function SHALL accept the trusted networks list and check it.

#### Scenario: WebSocket from trusted network without auth
- **WHEN** a WebSocket upgrade arrives from `192.168.1.42` with `trustedNetworks: ["192.168.1.0/24"]` and no auth cookie
- **THEN** the upgrade SHALL proceed

#### Scenario: WebSocket from untrusted IP without auth
- **WHEN** a WebSocket upgrade arrives from `203.0.113.5` with no auth cookie and auth is configured
- **THEN** the upgrade SHALL be rejected with 401

### Requirement: Auth hook tags authenticated requests
The auth plugin SHALL use `fastify.decorateRequest('isAuthenticated', false)` at registration time. When the `onRequest` hook verifies a valid JWT cookie, it SHALL set `request.isAuthenticated = true` before returning. When auth is not configured, `server.ts` SHALL register the `isAuthenticated` decorator with a default of `false` so the guard can safely read it in all cases.

#### Scenario: Valid JWT sets isAuthenticated
- **WHEN** auth is configured and a request arrives with a valid JWT cookie
- **THEN** the auth hook SHALL set `request.isAuthenticated = true`

#### Scenario: No auth configured
- **WHEN** auth is not configured
- **THEN** `request.isAuthenticated` SHALL be `false` (default decorator value)

#### Scenario: Invalid JWT
- **WHEN** auth is configured and a request arrives with an expired or invalid JWT
- **THEN** `request.isAuthenticated` SHALL remain `false`

### Requirement: Auth plugin reads merged trusted networks
The auth plugin `onRequest` hook SHALL skip authentication for requests from IPs matching `resolvedTrustedNetworks` (the merged list). This replaces the current `auth.bypassHosts`-only check.

#### Scenario: Auth bypassed for trusted network IP
- **WHEN** auth is configured and a request arrives from an IP in `resolvedTrustedNetworks`
- **THEN** the auth hook SHALL skip authentication for that request

### Requirement: isBypassedHost extracted to localhost-guard module
The `isBypassedHost()`, `matchCidr()`, and `ipToNum()` functions SHALL be moved from `auth-plugin.ts` to `localhost-guard.ts` and exported. The `auth-plugin.ts` SHALL import `isBypassedHost` from `localhost-guard.ts`.

#### Scenario: Auth plugin imports from localhost-guard
- **WHEN** the auth plugin needs CIDR matching
- **THEN** it SHALL import `isBypassedHost` from `localhost-guard.ts`

### Requirement: Network interfaces API endpoint
The server SHALL expose `GET /api/network-interfaces` as a localhost-only endpoint. It SHALL return `{ success: true, data: [...] }` where `data` is an array of detected non-internal IPv4 network interfaces. Each entry SHALL include `name` (interface name), `address` (IPv4 address), `netmask`, and `cidr` (computed CIDR notation, e.g. `192.168.1.0/24`). The CIDR SHALL be computed from the address and netmask.

The endpoint SHALL return **one entry per detected address** and SHALL NOT drop or merge entries. It has two consumers with opposing needs: the listen-interface picker requires every distinct bind address to remain selectable, while the trusted-networks dropdown wants one offer per range. Deduplication is therefore a **presentation** concern owned by the consumer, never by the endpoint.

Each entry SHALL additionally include:
- `label` — a human-meaningful name for the interface, used in place of the raw device name in the UI. A device carrying an address in `100.64.0.0/10` SHALL be labelled as a tailnet interface. When no meaningful label can be derived, `label` SHALL fall back to the device `name`, so the field is always populated.
- `pointToPoint` — `true` when the netmask is `255.255.255.255`. This is a netmask-derived flag, not an interrogation of the OS point-to-point interface flag; any `/32`-configured interface SHALL be treated the same way. A `/32` `cidr` matches exactly one address — the host itself — so it SHALL NOT be presented as a trustable network without a wider alternative.
- `suggestions` — the trust entries offered for this interface, each `{ value, label, wide }`, derived from the same well-known-range table as the block-event trust banner so the two paths never disagree about **which range** contains an address. They may still differ on the `wide` tier, which is contextual — see the `settings-panel` capability. For a non-point-to-point interface the netmask-derived `cidr` SHALL be the sole suggestion, marked `wide: false`. For a point-to-point interface the netmask-derived network is a single address, so the containing well-known range SHALL be offered and SHALL be marked `wide: true`, because it is broader than the interface's own network.

#### Scenario: Machine with Wi-Fi and Ethernet
- **WHEN** the machine has `en0` at `192.168.1.100/255.255.255.0` and `en7` at `10.0.0.50/255.255.0.0`
- **THEN** the endpoint SHALL return entries with `cidr: "192.168.1.0/24"` and `cidr: "10.0.0.0/16"`
- **AND** each SHALL carry a single narrow suggestion equal to its own `cidr`

#### Scenario: Remote request to endpoint
- **WHEN** a request to `GET /api/network-interfaces` arrives from a non-loopback IP
- **THEN** the server SHALL return 403

#### Scenario: Tailscale point-to-point interface is not offered as itself
- **GIVEN** the machine has `utun4` at `100.97.246.31` with netmask `255.255.255.255`
- **WHEN** the endpoint is called
- **THEN** the entry SHALL have `pointToPoint: true`
- **AND** it SHALL NOT offer `100.97.246.31/32` as a trustable suggestion
- **AND** it SHALL offer `100.64.0.0/10` as a wide suggestion
- **AND** its `label` SHALL identify it as a tailnet interface rather than `utun4`

#### Scenario: WireGuard point-to-point interface behaves the same
- **GIVEN** the machine has a `/32` interface whose address is in a well-known private range
- **WHEN** the endpoint is called
- **THEN** the entry SHALL have `pointToPoint: true`
- **AND** its suggestion SHALL be the containing range, marked wide

#### Scenario: Point-to-point address outside any well-known range
- **GIVEN** the machine has a `/32` interface whose address falls in no well-known private or CGNAT range
- **WHEN** the endpoint is called
- **THEN** the entry SHALL have `pointToPoint: true`
- **AND** it SHALL offer no suggestion, because no truthful range can be derived

#### Scenario: Endpoint keeps every address so the picker stays complete
- **GIVEN** the machine has `en0` at `192.168.10.123/255.255.255.0` and `en7` at `192.168.10.224/255.255.255.0`
- **WHEN** the endpoint is called
- **THEN** it SHALL return two entries, one per address
- **AND** both `192.168.10.123` and `192.168.10.224` SHALL remain selectable as specific bind addresses

#### Scenario: Label falls back to the device name
- **GIVEN** an interface whose address matches no well-known range
- **WHEN** the endpoint is called
- **THEN** its `label` SHALL equal its device `name`

#### Scenario: Range table agrees across both paths
- **GIVEN** an address in `100.64.0.0/10` on a `/32` point-to-point interface
- **WHEN** the containing range is derived for it from the interface AND from a block event
- **THEN** both SHALL name `100.64.0.0/10`

#### Scenario: Malformed trusted entry is ignored, never offered
- **GIVEN** a stored trusted entry that parses as neither exact IP, wildcard, nor CIDR
- **WHEN** suggestions and the reachability predicate are computed
- **THEN** the entry SHALL be skipped rather than reported unreachable or offered

### Requirement: Canonical UI write path is auth.bypassHosts
The top-level `config.trustedNetworks` field SHALL remain readable and SHALL continue to be merged into `resolvedTrustedNetworks` for backward compatibility with hand-edited `config.json` files. However, UI-driven additions to the trusted-networks list SHALL be written to `config.auth.bypassHosts` only. The UI SHALL NOT write new entries to top-level `config.trustedNetworks` and SHALL NOT remove existing entries from top-level `config.trustedNetworks`. The Settings-panel UI behavior for this section is specified by the `settings-panel` capability (see `Trusted Networks section on Security tab`).

#### Scenario: UI write flows to auth.bypassHosts
- **WHEN** a user adds a trusted network via the Settings UI
- **THEN** the resulting config write SHALL place the entry under `auth.bypassHosts`
- **AND** the resulting config write SHALL NOT modify top-level `trustedNetworks`

#### Scenario: Existing top-level trustedNetworks preserved
- **WHEN** `config.json` contains entries in top-level `trustedNetworks` prior to any UI interaction
- **THEN** those entries SHALL continue to load into `resolvedTrustedNetworks` via the existing merge
- **AND** those entries SHALL NOT be removed or migrated by UI operations

#### Scenario: UI removal targets auth.bypassHosts only
- **WHEN** a user removes an entry via the Settings UI and that entry exists in both `auth.bypassHosts` and top-level `trustedNetworks`
- **THEN** the UI SHALL remove the entry from `auth.bypassHosts` only
- **AND** the entry SHALL remain in top-level `trustedNetworks`
- **AND** the entry SHALL still be honored at runtime via the merge into `resolvedTrustedNetworks`

### Requirement: auth.bypassHosts honored without OAuth providers
The config module SHALL treat `config.auth.bypassHosts` and `config.auth.bypassUrls` as first-class configuration fields that are honored at load time regardless of whether `config.auth.providers` is present or non-empty. Specifically, `loadConfig()` SHALL produce a non-empty `resolvedTrustedNetworks` array whenever `config.auth.bypassHosts` contains entries, even if `config.auth.providers` is `{}` or absent. The existing merge semantics (deduplication, precedence, wildcard/CIDR/exact-IP formats) SHALL continue to apply.

The auth plugin SHALL continue to no-op when `providerRegistry.size === 0`: no OAuth routes registered, no `onRequest` hook installed, no cookie plugin initialized. The bypassHosts behaviour SHALL be served entirely through `resolvedTrustedNetworks` and the network guard.

#### Scenario: bypassHosts configured without providers
- **WHEN** config contains `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and no top-level `trustedNetworks`
- **THEN** `loadConfig()` SHALL return `resolvedTrustedNetworks: ["192.168.1.0/24"]`
- **AND** `config.auth` SHALL NOT be `undefined`
- **AND** `config.auth.bypassHosts` SHALL equal `["192.168.1.0/24"]`

#### Scenario: bypassHosts configured with no auth.providers key at all
- **WHEN** config contains `{ "auth": { "bypassHosts": ["10.0.0.0/8"] } }` with no `providers` key whatsoever
- **THEN** `loadConfig()` SHALL return `resolvedTrustedNetworks: ["10.0.0.0/8"]`

#### Scenario: bypassUrls configured without providers
- **WHEN** config contains `{ "auth": { "providers": {}, "bypassUrls": ["/webhooks/"] } }`
- **THEN** `loadConfig()` SHALL return a populated `config.auth.bypassUrls: ["/webhooks/"]`
- **AND** `config.auth` SHALL NOT be `undefined`

#### Scenario: auth with only empty arrays
- **WHEN** config contains `{ "auth": { "providers": {}, "bypassHosts": [], "bypassUrls": [] } }`
- **THEN** `loadConfig()` MAY return `config.auth` as `undefined` (no auth-relevant content)
- **AND** `resolvedTrustedNetworks` SHALL be an empty array

#### Scenario: bypassHosts merged with top-level trustedNetworks, no providers
- **WHEN** config contains `{ "trustedNetworks": ["192.168.1.0/24"], "auth": { "providers": {}, "bypassHosts": ["10.0.0.0/8"] } }`
- **THEN** `resolvedTrustedNetworks` SHALL contain both `192.168.1.0/24` and `10.0.0.0/8`
- **AND** the entries SHALL be deduplicated (if the same entry appears in both lists, it appears once in the result)

#### Scenario: Auth plugin stays inactive with bypassHosts-only config
- **WHEN** the server starts with `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }`
- **THEN** no OAuth routes (`/auth/login`, `/auth/callback`, etc.) SHALL be registered
- **AND** no cookie plugin SHALL be registered
- **AND** `request.isAuthenticated` SHALL default to `false` for all requests
- **AND** the network guard SHALL still admit requests from `192.168.1.0/24` via `resolvedTrustedNetworks`

### Requirement: WebSocket upgrade admits bypassHosts trust without OAuth
The WebSocket upgrade handler in `server.ts` SHALL admit a connection from an IP matching `resolvedTrustedNetworks` regardless of whether OAuth is configured. When `config.authConfig` is absent or its resolved provider registry is empty, the upgrade SHALL NOT require a JWT cookie; the IP match alone SHALL be sufficient to proceed.

#### Scenario: WebSocket upgrade from bypassHosts-only trusted network
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `192.168.1.42` with no auth cookie
- **THEN** the upgrade SHALL proceed (101 Switching Protocols)
- **AND** the connection SHALL NOT be rejected with 403 or 401

#### Scenario: WebSocket upgrade from untrusted IP in bypassHosts-only config
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `10.0.0.5` (not in trusted list)
- **THEN** the upgrade SHALL be rejected with 403

