## Purpose

Defines a core, identity-provider-agnostic seam that resolves a request's credential to a stable `(iss, sub)` principal with a credential expiry, through host-trusted, priority-ordered, bounded, fail-closed resolvers, integrated into the actual authentication gate and exposed as `request.principal` for downstream consumers.

## ADDED Requirements

### Requirement: Principal shape

The system SHALL define an immutable `Principal` value as `{ iss: string, sub: string, email?: string }`, where exact `(iss, sub)` is the identity join key and `email`, when present, is a non-authoritative display label. The system SHALL NOT treat `email` as an identity key.

#### Scenario: Principal carries the issuer-qualified subject
- **WHEN** a resolver returns a principal for a request
- **THEN** the principal exposes a non-empty `iss` and a non-empty `sub`
- **AND** any `email` present is available only as a label

#### Scenario: Resolved principal is immutable
- **WHEN** the system exposes a resolved principal on the request
- **THEN** the exposed value is a frozen copy of plain data
- **AND** a resolver cannot mutate request state after resolution via a retained reference or getter

### Requirement: Resolution result carries credential expiry

A successful resolution SHALL produce `{ principal, expiresAt }`, where `expiresAt` is the Unix epoch-millisecond expiry of the underlying credential. The system SHALL expose `request.principal` and `request.principalExpiresAt`, and SHALL reject a resolution whose `expiresAt` is not a finite timestamp in the future.

#### Scenario: Expiry accompanies the principal
- **WHEN** a resolver returns a valid principal for a bearer credential
- **THEN** the resolution includes `expiresAt` copied from the credential's expiry
- **AND** `request.principalExpiresAt` is set to that value

#### Scenario: Already-expired credential does not authenticate
- **WHEN** a resolution's `expiresAt` is at or before the current time
- **THEN** the result is treated as invalid and no principal is exposed

### Requirement: Curated authentication context

The system SHALL pass each resolver a curated `AuthContext` of `{ method: string, url: string, authorization?: string, cookie?: string, dpop?: string, isAuthenticated: boolean, ip: string }` and SHALL NOT pass the raw underlying request object. The context SHALL expose only this bounded allowlist, and SHALL include `method`, `url`, and the `dpop` header so a sender-constrained-token resolver (DPoP, RFC 9449) can validate a proof without a later schema change.

#### Scenario: Resolver receives only the curated context
- **WHEN** the resolution hook invokes a resolver
- **THEN** the resolver receives `method`, `url`, the authorization/cookie/dpop headers, the `isAuthenticated` boolean, and the client IP
- **AND** the resolver cannot reach request internals beyond that curated surface

#### Scenario: DPoP-bound token can be validated
- **WHEN** a resolver validates a sender-constrained (DPoP) access token
- **THEN** it can read the `dpop` proof header together with `method` and `url` from the context

### Requirement: Resolver registration requires a host trust grant

The system SHALL permit resolver registration only from the bundled dashboard resolver or from a plugin explicitly named in operator-controlled configuration (`identity.trustedResolverPlugins`). Self-declared `manifest.priority` SHALL NOT grant registration. A plugin not on the trust grant SHALL receive a no-op registrar and its resolver SHALL never run.

#### Scenario: Trusted plugin registers a resolver
- **WHEN** a plugin named in `identity.trustedResolverPlugins` registers a resolver
- **THEN** the resolver is added to the chain
- **AND** the registration returns an unsubscribe function

#### Scenario: Untrusted plugin attempt is inert
- **WHEN** a plugin not named in the trust grant attempts to register a resolver
- **THEN** no resolver is added and no request is ever routed to it

#### Scenario: Manifest priority does not confer trust
- **WHEN** a plugin declares `manifest.priority <= 100` but is not named in the trust grant
- **THEN** it still receives a no-op registrar

### Requirement: Deterministic priority-ordered first-match resolution

The system SHALL order resolvers by `(manifest.priority ascending, pluginId ascending)` and SHALL take the first resolver that returns a principal, stopping the walk. A resolver result SHALL be one of: a successful resolution (claim), `null` ("not my credential" — continue), or a reject ("my credential and it is invalid"). Ordering SHALL be deterministic across boots and SHALL NOT depend on registration/load order.

#### Scenario: Lower-priority-number resolver wins
- **WHEN** two resolvers would both claim and one has a lower priority number
- **THEN** the lower-numbered resolver's principal is used and the higher one is not consulted

#### Scenario: Equal priorities tie-break deterministically by plugin id
- **WHEN** two resolvers share the same priority number
- **THEN** they are ordered by plugin id, identically on every boot

#### Scenario: Non-claiming resolver falls through
- **WHEN** a resolver returns `null`
- **THEN** the next resolver in order is consulted

#### Scenario: Reject stops the chain fail-closed with a 401
- **WHEN** a resolver returns reject for a credential it owns but finds invalid
- **THEN** the walk stops, no principal is exposed, and the request is answered 401
- **AND** no lower-priority resolver claims it

### Requirement: Resolution is integrated into the authentication gate

The system SHALL dispatch resolution after the opaque paired-device bearer hook and before the legacy cookie-authentication hook can reject the request, so a valid bearer credential authenticates the request rather than being rejected. A successful resolution SHALL set `request.principal`, `request.principalExpiresAt`, and `request.isAuthenticated = true`. Resolvers SHALL be dispatched from a fixed position regardless of plugin load order.

#### Scenario: Bearer request authenticates before cookie rejection
- **WHEN** a request carries a valid bearer credential and no dashboard cookie
- **THEN** resolution sets the principal and `isAuthenticated` before the cookie hook runs
- **AND** the cookie hook observes an authenticated request and does not reject it

#### Scenario: Authenticated device bearer yields no principal
- **WHEN** a request is authenticated via the opaque paired-device path and no resolver recognizes it as a person
- **THEN** `request.principal` is `null` while `request.isAuthenticated` may be true

### Requirement: Resolved output is validated before exposure

The system SHALL validate a resolver's output before exposing it: reject empty/whitespace `iss` or `sub`, non-string label, absent or non-future `expiresAt`, non-plain-data shapes, and values exceeding bounded maximum lengths. A resolver's raw returned object SHALL NOT become request/ticket/socket state directly.

#### Scenario: Malformed principal is rejected
- **WHEN** a resolver returns an object with an empty `sub` or a missing `expiresAt`
- **THEN** the result is discarded as if the resolver returned `null`
- **AND** the event is logged

### Requirement: Fail-closed resolver isolation

A resolver that throws, rejects, or exceeds its configured time budget SHALL be treated as returning `null`, SHALL be logged, and SHALL NOT cause a server error. Resolution SHALL never itself grant authority; absence of a claim yields `null`.

#### Scenario: Throwing resolver is neutralized
- **WHEN** a resolver throws during resolution
- **THEN** it is treated as returning `null`, the event is logged, and the request continues, never a 500

#### Scenario: Slow resolver is bounded
- **WHEN** a resolver exceeds its time budget
- **THEN** it is treated as returning `null` and the walk continues

### Requirement: Resolution is inert until identity is enforced

The plane has no mode flag. Identity SHALL be **enforced** only while a trusted resolver is both registered and configured ("active") AND a trusted plugin has registered a browser login descriptor ("login provider registered"). While not enforced ("inert") — including a resolver that is active with NO login provider — the dispatch hook SHALL make no claim: `request.principal` and `request.principalExpiresAt` remain `null`, `request.isAuthenticated` is unaffected by resolution, and every authentication and routing outcome is identical to before this change. Wherever these specs say "the resolver is active", they SHALL be read as "identity is enforced" (design D21). A resolver that is active while no login provider is registered SHALL cause the server to log a warning before it starts listening, stating that identity is not enforced.

#### Scenario: No resolver active
- **WHEN** the server runs with no configured trusted resolver
- **THEN** every request has `request.principal === null`
- **AND** no authentication or routing behavior differs from before the seam existed

#### Scenario: Registered-but-unconfigured resolver stays inert
- **WHEN** the bundled resolver plugin is enabled but missing its `issuer`/`audience` configuration
- **THEN** the dispatch hook makes no claim
- **AND** `request.principal` is `null` and `request.isAuthenticated` is exactly what the pre-existing auth chain set

#### Scenario: Active resolver without a login provider stays inert (self-lockout guard)
- **WHEN** a trusted resolver is registered and configured but no trusted plugin has registered a browser login descriptor
- **THEN** identity is not enforced: the dispatch hook makes no claim, a genuinely-local browser loads the dashboard and opens its WebSocket as before this change, and remote access follows the pre-change network guard
- **AND** the server logs, before listening, that a resolver is configured but no login provider is registered so identity is NOT enforced

#### Scenario: Resolver plus login provider arms enforcement
- **WHEN** a trusted resolver is active AND a trusted plugin has registered a browser login descriptor
- **THEN** identity is enforced: bearer tokens resolve, session roads are owner-gated, and browser upgrades require an identity-bearing ticket

#### Scenario: A plugin that fails to load cannot arm enforcement
- **WHEN** a trusted plugin registers a resolver and/or a browser login descriptor during activation and its activation then fails
- **THEN** the host releases every identity registration that plugin made before the server starts listening, so the failed plugin neither arms enforcement nor advertises a login
- **AND** the server logs that the plugin's resolver/login registrations were released

#### Scenario: Login provider without an active resolver stays inert
- **WHEN** a trusted plugin registered a browser login descriptor but no trusted resolver is active
- **THEN** identity is not enforced, `GET /api/identity/login-config` returns `{ active: false }`, and the server logs that identity is NOT enforced because no principal resolver is active

#### Scenario: Genuinely-local caller is not reported authenticated while enforced
- **WHEN** identity is enforced and a genuinely-local browser without a resolved bearer queries the auth status the client uses to tell `auth_required` from `offline`
- **THEN** it is reported unauthenticated with authentication enabled, so the client shows its authentication-required state rather than "Server offline"; loopback is never treated as authentication on the enforced path

#### Scenario: Enforcement is decided once at startup and latched
- **WHEN** a plugin unregisters its resolver, login descriptor, or policy after the server has started listening, or a plugin is enabled or disabled at runtime
- **THEN** the enforced/not-enforced decision made before listening is unchanged for the life of the process — no road observes a mixed state and owner gating is never silently switched off for connected sockets — and the change takes effect on the next restart
- **AND** a plugin's unregister handle called after startup is a no-op and a registration attempted after startup is ignored, each logged, so the advertised login descriptor, the resolvers, and the policy stay exactly those the decision was made on

