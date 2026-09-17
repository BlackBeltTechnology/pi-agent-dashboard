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

### Requirement: Legacy mode is inert even when resolvers are registered

With `identity.mode = legacy` (the default), the system SHALL NOT dispatch resolvers: `request.principal` and `request.principalExpiresAt` remain `null`, `request.isAuthenticated` is unaffected by any resolver, and every authentication and routing outcome is identical to before this change — even if resolvers are registered in the registry. Resolver dispatch and policy evaluation activate only in multi-user mode.

#### Scenario: No resolvers registered in legacy mode
- **WHEN** the server runs in legacy mode with zero registered resolvers
- **THEN** every request has `request.principal === null`
- **AND** no authentication or routing behavior differs from before the seam existed

#### Scenario: Registered resolver stays inert in legacy mode
- **WHEN** the server runs in legacy mode but a resolver is registered
- **THEN** the dispatch hook does not invoke it
- **AND** `request.principal` is `null` and `request.isAuthenticated` is exactly what the pre-existing auth chain set
