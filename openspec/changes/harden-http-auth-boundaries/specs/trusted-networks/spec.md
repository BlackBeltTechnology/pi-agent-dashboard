## MODIFIED Requirements

### Requirement: Network trust mode
The config module SHALL support `network.trustMode` (`"pair"` | `"legacy"`) and `network.trustModeOrigin` (`"upgrade"` | `"operator"`).

**One-time decision at boot.** When the server starts, the configuration file parses, and `network.trustMode` is absent, it SHALL decide the mode once and persist it through the existing partial config write: `"pair"` if every entry of the resolved trusted list (`trustedNetworks` merged with `auth.bypassHosts`) is **loopback-only** — it admits no address outside `127.0.0.0/8`, `::1` and `::ffff:127.0.0.0/104` — (an empty list included), otherwise `"legacy"`. A match-all entry such as `0.0.0.0/0` or `*.*.*.*` is not loopback-only, and neither is any hostname entry (including `localhost`) — undecidable entries fall to `"legacy"` so an upgrade never locks a LAN user out; together with `trustModeOrigin: "upgrade"`. If the write fails, the server SHALL hold the decided mode as a process-level fallback, consulted only while the stored configuration holds no recognised `network.trustMode` (a stored value always wins, so a later successful operator save applies live), log one `[trusted-networks]` error, and decide again on the next boot. If the configuration file exists but cannot be parsed, the server SHALL NOT decide or write; it SHALL use `"legacy"` for the process as the fallback and log one `[trusted-networks]` error.

**Never re-derived.** Once `network.trustMode` holds a recognised value, the mode SHALL NOT change because the list changes — adding, removing or revoking entries SHALL leave the mode as stored. Any configuration write that changes a stored `network.trustMode` (UI, REST, CLI) SHALL set `trustModeOrigin: "operator"`; a stored mode with no origin (a hand edit) SHALL read as `"operator"`; a save that leaves the mode unchanged SHALL NOT touch the origin. Only the boot decision writes `"upgrade"`. A partial config write SHALL merge the `network` block field by field, so writing one of its fields never drops the other, and writing `network` never drops `auth` fields (or the reverse).

**Unrecognised value.** A present but unrecognised `network.trustMode` SHALL resolve to `"pair"` (fail closed), SHALL log one `[trusted-networks]` warning naming the value (once per process per distinct value, however often the mode is read), and SHALL NOT be overwritten by the boot decision. A present but unrecognised `network.trustModeOrigin` SHALL read as `"upgrade"` (fail closed, capped) with one warning per distinct value; an absent origin still reads `"operator"`.

The effective mode SHALL be read live through the same configuration snapshot the network guard reads, so an operator change takes effect without a restart.

#### Scenario: Unrecognised origin fails closed
- **GIVEN** stored `network.trustMode: "legacy"` with `network.trustModeOrigin: "banana"`
- **WHEN** a listed peer sends a mutating request with no credential
- **THEN** it SHALL be refused as in upgrade-decided legacy, with one `[trusted-networks]` warning for the value

#### Scenario: Fresh install decides pair
- **WHEN** the server boots with no `network.trustMode` and an empty resolved list
- **THEN** config SHALL be written with `network.trustMode: "pair"` and `network.trustModeOrigin: "upgrade"`

#### Scenario: Existing install with a LAN list decides legacy
- **WHEN** the server boots with no `network.trustMode` and `auth.bypassHosts: ["192.168.16.0/24"]`
- **THEN** config SHALL be written with `network.trustMode: "legacy"` and `network.trustModeOrigin: "upgrade"`
- **AND** a peer at `192.168.16.20` SHALL still be admitted without sign-in for observe-tier reads (see "Network-only HTTP admissions are capped at observe in upgrade-decided legacy mode")

#### Scenario: Match-all list decides legacy
- **WHEN** the server boots with no `network.trustMode` and a resolved list of only `["0.0.0.0/0"]` (or `["*.*.*.*"]`)
- **THEN** the decided mode SHALL be `"legacy"`

#### Scenario: Loopback-only list decides pair
- **WHEN** the server boots with no `network.trustMode` and a resolved list of only `["127.0.0.1", "127.0.0.4/30"]`
- **THEN** the decided mode SHALL be `"pair"`

#### Scenario: Adding a range never flips the mode
- **GIVEN** `network.trustMode: "pair"` is stored
- **WHEN** `198.51.100.23` is added to `auth.bypassHosts` and the server later restarts
- **THEN** the effective mode SHALL remain `"pair"` and `198.51.100.23` SHALL NOT be admitted without a credential

#### Scenario: Operator choice is recorded
- **WHEN** an operator saves `network.trustMode: "legacy"` from the Security page
- **THEN** config SHALL hold `network.trustModeOrigin: "operator"`

#### Scenario: Unknown value fails closed
- **WHEN** config holds `network.trustMode: "open"`
- **THEN** the effective mode SHALL be `"pair"`, one `[trusted-networks]` warning naming `"open"` SHALL be logged, and the stored value SHALL NOT be rewritten

#### Scenario: Boot write failure
- **WHEN** the boot decision cannot be persisted
- **THEN** every admission site SHALL use the decided mode for this process and one `[trusted-networks]` error SHALL be logged
- **AND** a later successful write of `network.trustMode: "legacy"` SHALL take effect on the next request without a restart

#### Scenario: Unparseable config is never overwritten
- **GIVEN** `config.json` exists but is not valid JSON
- **WHEN** the server boots
- **THEN** the file SHALL NOT be written, the effective mode SHALL be `"legacy"` for the process, and one `[trusted-networks]` error SHALL be logged

#### Scenario: Hostname entry decides legacy
- **WHEN** the server boots with no `network.trustMode` and a resolved list of only `["localhost"]` or `["nas.local"]`
- **THEN** the decided mode SHALL be `"legacy"`

#### Scenario: REST write records operator origin
- **WHEN** `PUT /api/config` changes `network.trustMode` from `"legacy"` to `"pair"` without naming an origin
- **THEN** config SHALL hold `network.trustModeOrigin: "operator"`

#### Scenario: Partial write keeps the origin
- **GIVEN** config holds `network: { trustMode: "legacy", trustModeOrigin: "upgrade" }`
- **WHEN** a partial write carries only `auth.bypassHosts`
- **THEN** both `network` fields SHALL be unchanged

#### Scenario: Mode change applies without restart
- **GIVEN** the effective mode is `"legacy"` and peer `192.168.16.20` is admitted by the list
- **WHEN** `network.trustMode` is written as `"pair"` while the server runs
- **THEN** the next unauthenticated HTTP request and the next ticketless WebSocket upgrade from `192.168.16.20` SHALL be denied without a restart

### Requirement: Network match does not authenticate in pair mode
When the effective trust mode is `"pair"`, a match of the socket peer against `trustedNetworks` / `auth.bypassHosts` SHALL NOT satisfy any admission or exemption decision. This SHALL hold at every site that consults the trusted list for admission: the HTTP network guard (per-route and universal hook), the OAuth `onRequest` bypass-host skip, the WebSocket upgrade with auth configured, the WebSocket upgrade with auth not configured, and the device-tier exemption. All of these sites SHALL obtain the list they match against **per request** from a single live source that yields an empty list under `"pair"`; no site SHALL hold a boot-time or reload-time copy of the list for admission.

Genuine-local callers (loopback, no forwarding header, subject to `requireLocalProof`), the local-IPC token, an authenticated login session, a valid device bearer or device cookie, a valid WebSocket ticket, and a valid model-proxy key SHALL be admitted exactly as before. The list itself SHALL remain stored, listed and editable; in `"pair"` mode it governs knock eligibility only (see the `lan-knock-pairing` capability). The CORS origin allowlist and the WebSocket origin gate MAY continue to match the list; they grant no credential.

#### Scenario: LAN peer in the list is denied in pair mode
- **GIVEN** effective mode `"pair"` and `auth.bypassHosts: ["192.168.16.0/24"]`
- **WHEN** `GET /api/sessions` arrives from `192.168.16.20` with no credential
- **THEN** the response SHALL be 403 with `error: "network_not_allowed"`

#### Scenario: WebSocket from a listed peer needs a ticket in pair mode
- **GIVEN** effective mode `"pair"`, auth not configured, and `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a `/ws` upgrade arrives from `192.168.16.20` with no ticket and no cookie
- **THEN** the upgrade SHALL be rejected

#### Scenario: OAuth bypass-host skip is inert in pair mode
- **GIVEN** effective mode `"pair"`, auth configured, and `auth.bypassHosts: ["10.0.0.0/8"]`
- **WHEN** a request arrives from `10.0.0.5` with no session cookie
- **THEN** the auth hook SHALL NOT skip authentication

#### Scenario: Listed peer bearing a device credential keeps its tier
- **GIVEN** effective mode `"pair"` and `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a request from `192.168.16.20` bearing an `observe` device credential calls `POST /api/restart`
- **THEN** the request SHALL be refused with 403 `insufficient_scope` (no trusted-network tier exemption)

#### Scenario: Paired browser on the LAN keeps working
- **GIVEN** effective mode `"pair"`
- **WHEN** a browser at `192.168.16.20` holding a valid device cookie requests `GET /api/sessions`
- **THEN** the request SHALL be served

#### Scenario: Genuine local unaffected
- **WHEN** `requireLocalProof` is disabled, effective mode is `"pair"`, and a request arrives from `127.0.0.1` with no forwarding header
- **THEN** it SHALL be admitted

#### Scenario: Legacy mode keeps today's behaviour
- **GIVEN** effective mode `"legacy"` and `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** `GET /api/sessions` (an observe-tier read) arrives from `192.168.16.20` with no credential
- **THEN** the request SHALL be admitted (mutating routes follow the read-only cap unless the operator chose `legacy`)

### Requirement: Network guard factory
The `localhost-guard` module SHALL export a `createNetworkGuard(trustedNetworks: string[] | (() => string[]))` function that returns a Fastify preHandler. The returned handler SHALL allow requests that satisfy any of: (a) genuinely local — loopback peer (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) **and** no proxy-forwarding header, (b) a valid local-IPC token, (c) `request.isAuthenticated` is `true` (set by the auth `onRequest` hooks), (d) **only when the effective trust mode is `"legacy"`**, `isTrustedSource(ip, headers, trustedNetworks)` is `true` (and, for an upgrade-decided `legacy` mode, the request is an observe-tier read or a model-proxy request — see "Network-only HTTP admissions are capped at observe in upgrade-decided legacy mode"), or (e) the request carries an accepted plugin capability stamp (see `plugin-capability-routes`). Condition (c) SHALL be evaluated before (d).

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

#### Scenario: Capability-stamped request allowed
- **WHEN** an unauthenticated remote request carries an accepted capability stamp
- **THEN** the guard SHALL allow it, so a plugin route attaching `ctx.networkGuard` agrees with the universal hook

### Requirement: Access settings show the migration banner
When the effective trust mode is `"legacy"` and at least one network-only admission was recorded in the window, `Settings → Access` SHALL show a banner stating how many distinct device addresses reach the dashboard by network trust only, with a link to the Security tab's network access section, where devices are paired and the mode is switched. When `trustModeOrigin` is `"upgrade"` the banner SHALL be a warning that also states those devices are read-only until paired; when it is `"operator"` it SHALL be informational and state that network trust is the operator's choice. The banner SHALL NOT be shown in `"pair"` mode. The Access page itself SHALL gain no grant-creation or mode control (its revoke-only contract stands). The data SHALL come from `/api/health` `trustPosture` (see "Loopback trusted entries are reported as inert").

#### Scenario: Banner names the device count
- **GIVEN** effective mode `"legacy"`, origin `"upgrade"`, and 3 distinct network-only peers in the window
- **WHEN** an operator opens `Settings → Access`
- **THEN** a warning banner SHALL state that 3 devices reach this dashboard by network trust only and link to the Security network access section

#### Scenario: Operator opt-in is informational
- **GIVEN** effective mode `"legacy"`, origin `"operator"`, and at least one network-only peer
- **WHEN** `Settings → Access` opens
- **THEN** the banner SHALL be informational and state that network trust is the operator's choice

#### Scenario: Network-admitted caller learns nothing
- **GIVEN** effective mode `"legacy"` and a caller admitted only by a listed LAN address, with no credential
- **WHEN** it opens `Settings → Access`
- **THEN** `trustPosture` SHALL be `null` for it and no banner SHALL be shown (it must sign in or pair to see the posture)

#### Scenario: No banner in pair mode
- **WHEN** the effective mode is `"pair"`
- **THEN** no network-trust migration banner SHALL be shown


## ADDED Requirements

### Requirement: Network-only HTTP admissions are capped at observe in upgrade-decided legacy mode
While the effective trust mode is `legacy` and `network.trustModeOrigin` is not `operator`, a request admitted only by a trusted-network match SHALL reach observe-tier `/api/*` routes and the model proxy only. Any other guarded request SHALL get the unchanged `network_not_allowed` 403 (mode undisclosed), keep the block-event record, raise no network-grant prompt and be counted once. Operator-chosen `legacy` and `pair` are unchanged.

#### Scenario: Observe-tier read still admitted
- **GIVEN** effective mode `"legacy"`, origin `"upgrade"`, `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** `GET /api/sessions` arrives from `192.168.16.20` with no credential
- **THEN** the request SHALL be admitted and counted as a network-only admission

#### Scenario: Mutation from a listed peer is refused
- **GIVEN** the same configuration
- **WHEN** `POST /api/session/spawn` or `PUT /api/config` arrives from `192.168.16.20` with no credential
- **THEN** the response SHALL be 403 `error: "network_not_allowed"` with the same body as any other refused caller, and nothing SHALL change

#### Scenario: Operator-chosen legacy is unchanged
- **GIVEN** effective mode `"legacy"`, origin `"operator"`
- **WHEN** `POST /api/session/spawn` arrives from a listed peer with no credential
- **THEN** it SHALL be admitted as before

#### Scenario: Unparseable configuration fallback is capped
- **GIVEN** `config.json` is unparseable and the process uses `"legacy"` with no origin
- **WHEN** a mutating request arrives from a listed peer with no credential
- **THEN** it SHALL be refused

#### Scenario: Refusals are counted and logged once per hour
- **WHEN** a listed peer is refused 50 times in one hour
- **THEN** the refusals SHALL be counted separately from admissions in `trustPosture.networkOnly`, and exactly one `[trusted-networks]` line naming the peer SHALL be logged in that hour

#### Scenario: Capped refusal raises no network-grant prompt
- **GIVEN** the capped legacy configuration
- **WHEN** a listed peer's mutating request is refused
- **THEN** the network-denial observer SHALL NOT run and no operator prompt SHALL be raised for that already-listed peer
- **AND** the refusal SHALL still be recorded as a block event (`GET /api/tunnel/block-events`)

#### Scenario: A refused-only peer is counted
- **WHEN** a listed peer is refused but never admitted
- **THEN** `trustPosture.networkOnly.distinctPeers` SHALL include it, a peer both admitted and refused SHALL count once, admission and refusal log lines SHALL be throttled separately, and admitted and refused peers SHALL share one map bounded by `MAX_PEERS`

#### Scenario: One request is one refusal
- **WHEN** a refused request is evaluated by both the per-route guard and the universal hook
- **THEN** the `refused` counter SHALL rise by one

#### Scenario: Mode change applies without restart
- **WHEN** an operator writes `network.trustMode: "legacy"` with origin `operator` (or `"pair"`) while the server runs
- **THEN** the next mutating request from the listed peer SHALL follow the new mode

### Requirement: The legacy cap also covers WebSocket upgrades
While the cap in "Network-only HTTP admissions are capped at observe in upgrade-decided legacy mode" applies, a browser `/ws` admitted only by a trusted-network match SHALL carry tier `observe`, and every other upgrade scope (terminal, live-preview, `/ws/bridge`, plugin scopes, `/editor/*`) from such a peer SHALL be refused. The same cap is restated in "WebSocket upgrade respects trusted networks" and "WebSocket upgrade admits bypassHosts trust without OAuth".

#### Scenario: Listed peer's browser socket is read-only
- **GIVEN** the capped legacy configuration and a `/ws` upgrade from a listed peer with no ticket or cookie
- **WHEN** the socket sends a message above `observe`
- **THEN** the message SHALL be dropped and one `auth.tier_refused` line SHALL be logged for that socket and type

#### Scenario: Listed peer cannot open a terminal
- **WHEN** a `/ws/terminal/:id` upgrade arrives from a listed peer with no credential
- **THEN** the server SHALL respond `HTTP/1.1 403`

#### Scenario: Listed peer cannot open other scopes
- **WHEN** a credential-less listed peer upgrades `/ws/bridge`, a plugin WebSocket route or `/editor/`
- **THEN** the server SHALL respond `HTTP/1.1 403`

#### Scenario: Listed peer can still open the read-only UI socket
- **WHEN** a `/ws` upgrade arrives from a listed peer with no credential
- **THEN** the upgrade SHALL proceed

#### Scenario: Operator-chosen legacy keeps the full socket
- **GIVEN** effective mode `"legacy"` with origin `"operator"`
- **WHEN** the same upgrade arrives
- **THEN** the socket SHALL carry no tier cap

### Requirement: The legacy cap covers live-preview capability mints
While the cap applies, network trust alone SHALL NOT prove a caller for a port-target live-preview mint (`POST /api/live-server/:id/capability`, an `observe` route), whatever `requireLocalProof` says. A capability minted for a network-only principal SHALL stop validating while the cap applies, on HTTP and WebSocket.

#### Scenario: Listed peer cannot mint a port-target live capability
- **GIVEN** effective mode `"legacy"`, origin `"upgrade"`, `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a listed peer with no credential posts a mint for a port target
- **THEN** the response SHALL be a `control` tier refusal and no capability SHALL be issued

#### Scenario: Network-minted capability dies under the cap
- **GIVEN** a capability minted for a network-only principal and the capped legacy configuration
- **WHEN** it is presented on `/live/<id>/~c/<token>/…` or on a live WebSocket upgrade
- **THEN** it SHALL be refused, while under operator-origin `legacy` it SHALL stay valid

## MODIFIED Requirements

### Requirement: WebSocket upgrade respects trusted networks
The WebSocket upgrade handler in `server.ts` SHALL check genuine-local, local-IPC token, ticket and auth, and — **only when the effective trust mode is `"legacy"`** — trusted networks. When the identity floor requires a principal-bearing ticket for the upgrade's scope, that rule SHALL take precedence over every allowance in this requirement, in both modes. In `"legacy"` mode a connection SHALL be allowed without authentication when `isTrustedSource(remoteAddress, headers, trustedNetworks)` is `true`; credential checks (ticket, cookie) SHALL be evaluated before this network match. In upgrade-decided `legacy` mode the match alone admits `/ws` as a read-only socket only; terminal and live-preview upgrades from a credential-less match SHALL be refused (see "The legacy cap also covers WebSocket upgrades"). The `validateWsUpgrade` function SHALL accept the admission list and the upgrade headers and SHALL use `isTrustedSource`.

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: WebSocket from trusted network without auth
- **WHEN** the identity floor is not enforced, the effective trust mode is `"legacy"`, and a WebSocket upgrade arrives from `192.168.1.42` with `trustedNetworks: ["192.168.1.0/24"]` and no auth cookie
- **THEN** the upgrade SHALL proceed (as a read-only socket when `network.trustModeOrigin` is not `"operator"`)

#### Scenario: Credential-less terminal upgrade from a listed network in upgrade-decided legacy mode
- **WHEN** the effective trust mode is `"legacy"` with origin `"upgrade"` and a `/ws/terminal/:id` upgrade arrives from a listed peer with no ticket and no auth cookie
- **THEN** the upgrade SHALL be rejected

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
**Only when the effective trust mode is `"legacy"`**, the WebSocket upgrade handler in `server.ts` SHALL admit a connection from an IP matching `resolvedTrustedNetworks` regardless of whether OAuth is configured. When `config.authConfig` is absent or its resolved provider registry is empty and the mode is `"legacy"`, the upgrade SHALL NOT require a JWT cookie; the IP match alone SHALL be sufficient to proceed to `/ws`, as a read-only socket when `network.trustModeOrigin` is not `"operator"`; terminal and live-preview upgrades then still need a credential. In `"pair"` mode the IP match SHALL NOT be sufficient.

When `requireLocalProof` is in effect (the default: absent or `true`), `isTrustedSource` SHALL additionally return `false` for a loopback-range peer that presents no local proof (local token, local credential proof, or local-proof cookie), as specified by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: WebSocket upgrade from bypassHosts-only trusted network
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` (effective mode `"legacy"`) and a WebSocket upgrade request arrives from `192.168.1.42` with no auth cookie
- **THEN** the upgrade SHALL proceed (101 Switching Protocols), as a read-only socket when `network.trustModeOrigin` is not `"operator"`
- **AND** the connection SHALL NOT be rejected with 403 or 401

#### Scenario: WebSocket upgrade from listed network in pair mode
- **WHEN** config is `{ "network": { "trustMode": "pair" }, "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `192.168.1.42` with no ticket and no auth cookie
- **THEN** the upgrade SHALL be rejected with 403

#### Scenario: WebSocket upgrade from untrusted IP in bypassHosts-only config
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `10.0.0.5` (not in trusted list)
- **THEN** the upgrade SHALL be rejected with 403

### Requirement: Network guard threaded to all protected routes
The network guard SHALL be enforced as a single universal Fastify `onRequest`
hook whose jurisdiction is the sensitive HTTP namespaces (`/api/*`, `/v1/*`,
`/editor/*`, `/live/*`), installed once at startup and running regardless of
whether `config.authConfig` is present. Within jurisdiction the guard SHALL
deny-by-default: a request is allowed only if it satisfies a pass condition or an
in-namespace public exception. This replaces reliance on per-route
`preHandler: networkGuard` opt-in as the primary enforcement mechanism.
Route files SHALL continue to receive the guard via their `RouteDeps`
`networkGuard` field (created once at startup over the live admission-list thunk);
that threading remains valid but is no longer the protection boundary.

No route SHALL be reachable through the sensitive namespaces without the network guard because it was registered late (for example by a plugin hot-load). Registering a route after the server has started SHALL fail, and the route SHALL NOT be served; that refusal is the enforcement. The server SHALL NOT work around it by serving sensitive-namespace routes from a second server instance or other after-start mechanism without the guard installed, and a regression test SHALL fail if post-start route registration stops being refused. A failed post-start registration SHALL be logged and the registering plugin marked failed; the server SHALL keep running. Any future facility that adds routes after start SHALL install the network guard on them.

Jurisdiction and in-namespace exception matching SHALL operate on the parsed
request **pathname** (query string and fragment stripped), with prefix matches
anchored on a trailing slash, so neither a query string (`/api/health?x=1`) nor a
near-miss prefix (`/apiv2`, `/api/healthz`) changes the decision.

The guard SHALL be registered as the **last** `onRequest` hook unconditionally —
after the host gate, CORS, the mutation-origin gate, CSP, `registerBearerAuth`,
`registerAuthPlugin` (when configured), the live-preview capability hook, the route-tier gate, and the model-proxy
auth gate (when configured) — so `request.isAuthenticated` reflects every auth
source when the guard evaluates. "Last" SHALL NOT be expressed relative to a
conditional hook.

The guard SHALL read the admission list (the trusted-network set in `"legacy"`
mode, empty in `"pair"` mode) through the live thunk, never a boot snapshot, so a
CIDR added at runtime in `"legacy"` mode admits without a restart and a switch to
`"pair"` mode stops admitting without a restart.

A denial by the universal guard SHALL preserve the existing denial contract: the
`network_not_allowed` response body clients branch on, and the `blockEvents`
recording that feeds `GET /api/tunnel/block-events`. A refusal under the legacy cap
(see "Network-only HTTP admissions are capped at observe in upgrade-decided legacy mode")
keeps that recording and suppresses only the network-grant prompt. Core route registrations MAY retain their existing
`preHandler: networkGuard` as redundant defense-in-depth; these SHALL NOT be
required for a route to be protected.

#### Scenario: sensitive route protected by the universal hook alone
- **WHEN** the per-route `preHandler` is absent but the universal hook is installed, and a request to `POST /api/sessions/:id/prompt` arrives from an untrusted, unauthenticated IP
- **THEN** the request SHALL be denied by the universal hook (403)

#### Scenario: retained per-route guard is harmless
- **WHEN** a core route still declares `preHandler: networkGuard` and the universal hook is installed
- **THEN** the request SHALL be evaluated consistently (both agree) and SHALL NOT be double-rejected or error

#### Scenario: denial keeps the existing response contract
- **WHEN** the universal hook denies an in-jurisdiction request
- **THEN** the response body SHALL be the existing `network_not_allowed` shape
- **AND** the denial SHALL be recorded in the `blockEvents` buffer exposed by `GET /api/tunnel/block-events`

#### Scenario: runtime-added trusted CIDR admits without restart
- **WHEN** the effective trust mode is `"legacy"`, a CIDR is added to the trusted-network set while the server is running, and an observe-tier read (or, under operator-origin `legacy`, any request) arrives from that network
- **THEN** the guard SHALL allow it without a restart

#### Scenario: Session route uses network guard
- **WHEN** the effective trust mode is `"legacy"` with `network.trustModeOrigin: "operator"` (or the request is an observe-tier read) and a request to `POST /api/sessions/:id/prompt` arrives from a trusted network IP
- **THEN** the route SHALL allow the request (guard passes)

#### Scenario: Session route denies a listed peer in pair mode
- **WHEN** the effective trust mode is `"pair"` and an unauthenticated request to `POST /api/sessions/:id/prompt` arrives from a listed network IP
- **THEN** the route SHALL return 403

#### Scenario: File route uses network guard
- **WHEN** a request to `GET /api/browse` arrives from an untrusted IP
- **THEN** the route SHALL return 403

#### Scenario: Late-registered route is not left unguarded
- **WHEN** code attempts to register a route under a sensitive namespace after the server has started
- **THEN** the registration SHALL fail and the route SHALL NOT be served
- **AND** where a future mechanism permits post-start routes, a request to such a route from an untrusted, unauthenticated IP SHALL be denied by the network guard

#### Scenario: Failed post-start registration does not stop the server
- **WHEN** a plugin's route registration fails after the server has started
- **THEN** the failure SHALL be logged and the plugin marked failed
- **AND** the server SHALL keep serving all other routes

### Requirement: Guard jurisdiction and in-namespace public exceptions
The guard SHALL act only on requests within its jurisdiction namespaces (`/api/*`,
`/v1/*`, `/editor/*`, `/live/*`). Within `/api`, it SHALL allow these in-namespace
public exceptions without a pass condition: `GET /api/health`, the
`PUBLIC_PAIRING_PREFIXES` paths, configured `auth.bypassUrls` prefixes, and a request
the capability hook stamped as accepted (see `plugin-capability-routes`).

All other in-jurisdiction requests SHALL require a pass condition: loopback /
genuine-local, local-IPC token, `isAuthenticated`, or — in `"legacy"` trust mode
only — a trusted-network IP. In upgrade-decided legacy (`trustModeOrigin` ≠
`"operator"`) that last pass admits only observe-tier `/api/*` reads and model-proxy
requests (see "Network-only HTTP admissions are capped at observe in upgrade-decided
legacy mode").

Within `/api`, an enabled plugin public namespace (`/api/plugins/<id>/public/`, see
`plugin-public-routes`) is an additional in-namespace public exception; a disabled
namespace is answered `404` before the guard runs. Exceptions are evaluated on both
the raw and the resolved target.

#### Scenario: health endpoint reachable unauthenticated
- **WHEN** an unauthenticated, untrusted request arrives at `GET /api/health`
- **THEN** the guard SHALL allow it

#### Scenario: pairing bootstrap reachable unauthenticated
- **WHEN** an unauthenticated request arrives at a `PUBLIC_PAIRING_PREFIXES` path (e.g. `/api/pair/redeem`)
- **THEN** the guard SHALL allow it

#### Scenario: query string does not defeat an exception
- **WHEN** an unauthenticated, untrusted request arrives at `GET /api/health?probe=1`
- **THEN** the guard SHALL allow it (matching is on the pathname, not the raw URL)

#### Scenario: near-miss path is not treated as an exception
- **WHEN** an unauthenticated, untrusted request arrives at `GET /api/healthz`
- **THEN** the guard SHALL deny it (exception matching is anchored, not a loose prefix)

#### Scenario: HEAD health check allowed
- **WHEN** an unauthenticated, untrusted `HEAD /api/health` request arrives
- **THEN** the guard SHALL allow it (the exception is not GET-only)

#### Scenario: unparseable URL fails closed
- **WHEN** a request arrives whose URL cannot be parsed into a pathname
- **THEN** the guard SHALL treat it as in-jurisdiction and deny it

#### Scenario: ws-ticket mint requires a pass condition
- **WHEN** an unauthenticated, untrusted request arrives at the `/api` ws-ticket mint endpoint
- **THEN** the guard SHALL deny it (the mint is not public)

#### Scenario: capability prefix admits only a verified GET
- **WHEN** an unauthenticated, untrusted request arrives at a registered plugin capability prefix
- **THEN** the guard SHALL allow it only if the capability hook stamped it as accepted, and SHALL deny it otherwise

#### Scenario: Enabled plugin public namespace reachable from any peer
- **WHEN** an unauthenticated request from an untrusted network arrives at an enabled `/api/plugins/web-chat/public/messages`
- **THEN** the guard SHALL allow it

#### Scenario: Other plugin routes stay guarded
- **WHEN** the same request targets `/api/plugins/web-chat/config`
- **THEN** the guard SHALL require a pass condition as before


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
- **THEN** the trusted-network pass condition SHALL admit it, subject to the legacy cap (an observe-tier read only when `network.trustModeOrigin` is not `"operator"`)

#### Scenario: LAN trusted CIDR does not admit in pair mode
- **GIVEN** `trustedNetworks: ["192.168.16.0/24"]` and effective trust mode `"pair"`
- **WHEN** an unauthenticated request arrives from peer `192.168.16.20`
- **THEN** no trusted-network pass condition SHALL admit it

### Requirement: auth.bypassHosts honored without OAuth providers
The config module SHALL treat `config.auth.bypassHosts` and `config.auth.bypassUrls` as first-class configuration fields that are honored at load time regardless of whether `config.auth.providers` is present or non-empty. Specifically, `loadConfig()` SHALL produce a non-empty `resolvedTrustedNetworks` array whenever `config.auth.bypassHosts` contains entries, even if `config.auth.providers` is `{}` or absent. The existing merge semantics (deduplication, precedence, wildcard/CIDR/exact-IP formats) SHALL continue to apply.

The auth plugin SHALL continue to no-op when `providerRegistry.size === 0`: no OAuth routes registered, no `onRequest` hook installed. Cookie parsing (`@fastify/cookie`) SHALL be registered once at server level, independent of providers, and SHALL NOT by itself authenticate any request. The bypassHosts behaviour SHALL be served entirely through `resolvedTrustedNetworks` and the network guard, and SHALL admit by network match only in `"legacy"` trust mode (observe-tier reads only while the mode is upgrade-decided).

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
- **WHEN** the server starts with `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and no `network.trustMode`
- **THEN** no OAuth routes (`/auth/login`, `/auth/callback`, etc.) SHALL be registered
- **AND** the auth plugin SHALL register no cookie plugin of its own (the server-level cookie parser is unaffected)
- **AND** `request.isAuthenticated` SHALL default to `false` for all requests
- **AND** the effective trust mode SHALL be `"legacy"` (origin `"upgrade"`) and the network guard SHALL still admit observe-tier reads from `192.168.1.0/24` via `resolvedTrustedNetworks`, and every request when the operator chose `legacy`

### Requirement: Loopback trusted entries are reported as inert
When the resolved trusted list (`trustedNetworks` merged with `auth.bypassHosts`) contains entries matching a loopback probe (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), the server SHALL log one `[trusted-networks]` warning naming each such entry and stating it is ignored for tunnel-relayed requests. The warning SHALL be deduplicated by the set of loopback-covering entries, not by the config file stamp, and SHALL NOT be recomputed while the resolved trusted-list array is unchanged (per-request cost on a snapshot cache hit is a reference compare).

`/api/health` SHALL include an additive field `trustPosture`, non-null only when `canDiscloseAccessPosture(request)` is true, of the shape:

```
trustPosture: {
  trustedHasLoopback: boolean,
  trustMode: "pair" | "legacy",
  trustModeOrigin: "upgrade" | "operator" | null,
  networkOnly: { admissions: number, refused: number, distinctPeers: number, lastAt: number | null }
} | null
```

`trustModeOrigin` SHALL be `null` for an unrecognised stored value. `networkOnly` SHALL reflect the in-memory counters of "Network-only admissions are observed in legacy mode" plus `refused`, the capped refusals; `distinctPeers` counts every peer admitted or refused (all zero / `null` in `"pair"` mode). Peer addresses SHALL NOT be included in `/api/health`.

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
- **THEN** the response SHALL include `trustPosture` with `trustedHasLoopback: true`, the effective `trustMode`, `trustModeOrigin`, and `networkOnly`
- **AND** an unauthenticated non-local caller SHALL receive `trustPosture: null`

#### Scenario: Health reports network-only admissions
- **GIVEN** effective mode `"legacy"` and two distinct peers made network-only admissions
- **WHEN** a genuine-local caller requests `/api/health`
- **THEN** `trustPosture.networkOnly.distinctPeers` SHALL be `2`
- **AND** no peer address SHALL appear in the response

#### Scenario: Health reports capped refusals
- **GIVEN** effective mode `"legacy"`, origin `"upgrade"`, and a listed peer refused twice by the legacy cap
- **WHEN** a genuine-local caller requests `/api/health`
- **THEN** `trustPosture.networkOnly.refused` SHALL be `2`
