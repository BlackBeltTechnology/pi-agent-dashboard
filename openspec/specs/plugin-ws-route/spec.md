# plugin-ws-route Specification

## Purpose
Lets a dashboard plugin own a WebSocket route scope on the main HTTP listener, with the core upgrade gate still enforcing host admission, origin policy (optionally replaced by a plugin-declared exact-match origin allowlist), and a genuinely-local-peer requirement before delegating the upgrade; the plugin's own per-connection secret is the credential.

## Requirements

### Requirement: Plugins register WebSocket route scopes

The server plugin context SHALL expose `registerWsRoute(scope, opts)` where `scope` is a kebab-case string unique across plugins, and `opts` declares `pathPrefix` (under `/ws/`), `admitOrigins` (exact Origin strings; when non-empty this list replaces the dashboard origin policy for the scope; may be empty), and `handleUpgrade(request, socket, head, meta)`. Registration SHALL happen during plugin server-entry activation; registrations attempted after that activation completes SHALL be rejected. Each activation (including re-activation after a loader toggle) registers afresh.

#### Scenario: Registration succeeds

- **WHEN** a plugin calls `registerWsRoute("browser-ext", {pathPrefix: "/ws/browser-ext/", admitOrigins: ["chrome-extension://…"], handleUpgrade})` during activation
- **THEN** upgrades whose path starts with `/ws/browser-ext/` SHALL resolve to scope `browser-ext` and, after the core gates pass, reach the plugin's `handleUpgrade`

#### Scenario: Duplicate scope or prefix

- **WHEN** two plugins register the same scope or overlapping `pathPrefix`
- **THEN** the second registration SHALL throw, the plugin SHALL be marked failed in `/api/health.plugins[]`, and the first registration SHALL remain active

#### Scenario: Re-activation registers again

- **WHEN** a plugin owning WS routes is toggled off and then on
- **THEN** its second activation's `registerWsRoute` SHALL succeed and upgrades SHALL reach the new `handleUpgrade`

#### Scenario: Core scopes are reserved

- **WHEN** a plugin attempts to register `browser`, `terminal`, `live`, or `bridge`, or a prefix colliding with `/ws`, `/ws/terminal/`, `/live/`, `/ws/bridge`
- **THEN** registration SHALL throw

### Requirement: Core gates run before plugin delegation

For a plugin-registered scope the upgrade handler SHALL apply, in order: host admission (unchanged); origin admission — when `admitOrigins` is non-empty the request Origin MUST exactly equal one entry (the dashboard origin policy is NOT consulted), when empty the dashboard origin policy applies unchanged; then the peer MUST be genuinely local: loopback remote address, request `Host` naming a loopback host (`127.0.0.1`, `[::1]`, `localhost`, any port), and no proxy-forwarding header present (`x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-server`, `x-forwarded-port`, `x-real-ip`, `forwarded`, `via`). Session cookies, the local IPC token, single-use tickets, and trusted-CIDR bypass SHALL NOT be evaluated for plugin scopes — the plugin's `handleUpgrade` is responsible for its own per-connection credential.

#### Scenario: Pinned origin admitted

- **WHEN** an upgrade to a plugin scope with non-empty `admitOrigins` carries a listed Origin from a loopback peer
- **THEN** the origin gate SHALL pass and the upgrade SHALL reach `handleUpgrade`

#### Scenario: Loopback page origin rejected on a pinned scope

- **WHEN** an upgrade to a plugin scope with non-empty `admitOrigins` carries `Origin: http://localhost:5173` (which the dashboard origin policy would admit) from a loopback peer
- **THEN** the upgrade SHALL be rejected with HTTP 403

#### Scenario: Cookie holder without the plugin secret

- **WHEN** a loopback peer presents a valid dashboard session cookie on a plugin scope but `handleUpgrade` rejects its per-connection credential
- **THEN** the upgrade SHALL be rejected — the cookie SHALL NOT substitute for the plugin credential

#### Scenario: Tunnel Host rejected deterministically

- **WHEN** an upgrade to a plugin scope arrives from a loopback remote address but with a non-loopback `Host` (e.g. the tunnel's public hostname) or with any `x-forwarded-*` / `forwarded` / `via` header
- **THEN** the upgrade SHALL be rejected with HTTP 403 regardless of whether the tunnel injects other markers

#### Scenario: No auth secret configured

- **WHEN** the dashboard runs without `authConfig.secret` and a trusted-CIDR peer (non-loopback) attempts a plugin-scope upgrade
- **THEN** the upgrade SHALL be rejected with HTTP 403 (the no-secret CIDR fallback does not apply to plugin scopes)

#### Scenario: Pinned origin on a core scope is not admitted

- **WHEN** the same Origin is presented on `/ws` (core `browser` scope)
- **THEN** the existing origin policy SHALL apply unchanged and the upgrade SHALL be rejected

#### Scenario: Ticket presented to plugin scope

- **WHEN** an upgrade to a plugin scope presents a valid ticket minted for that scope name
- **THEN** the ticket SHALL NOT be accepted and `POST /api/ws-ticket` SHALL refuse to mint tickets for plugin scopes

### Requirement: Plugin disable tears down its routes

When a plugin owning WS routes is disabled or fails, its scopes SHALL be unregistered and open sockets on them SHALL be closed with code 1001.

#### Scenario: Plugin toggled off

- **WHEN** `POST /api/plugins/browser/toggle` disables the plugin
- **THEN** subsequent upgrades to its prefixes SHALL be rejected with 404 and existing sockets SHALL close with 1001 within 1 s
