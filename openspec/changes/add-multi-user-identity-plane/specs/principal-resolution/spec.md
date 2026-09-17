## Purpose

Defines a core, identity-provider-agnostic seam that resolves an authenticated request to a stable `(iss, sub)` principal through priority-ordered, trust-gated, fail-closed plugin resolvers, and exposes the result as `request.principal` for downstream consumers.

## ADDED Requirements

### Requirement: Principal shape

The system SHALL define a `Principal` value as `{ iss: string, sub: string, email?: string }`, where `(iss, sub)` is the stable identity join key and `email`, when present, is a non-authoritative display label. The system SHALL NOT treat `email` as an identity key.

#### Scenario: Principal carries the issuer-qualified subject
- **WHEN** a resolver returns a principal for an authenticated request
- **THEN** the principal exposes a non-empty `iss` and a non-empty `sub`
- **AND** any `email` present is available only as a label

### Requirement: Request principal exposure

The system SHALL expose `request.principal` on every request, typed `Principal | null`, defaulting to `null`. Consumers SHALL gate authority on the presence of `request.principal`, never on `request.isAuthenticated`.

#### Scenario: No resolver claims the request
- **WHEN** the request completes the auth chain and no registered resolver returns a principal
- **THEN** `request.principal` is `null`

#### Scenario: A resolver claims the request
- **WHEN** a registered resolver returns a non-null principal for the request
- **THEN** `request.principal` equals that principal for the remainder of request handling

### Requirement: Curated authentication context

The system SHALL pass each resolver a curated `AuthContext` of `{ method: string, url: string, authorization?: string, cookie?: string, dpop?: string, isAuthenticated: boolean, ip: string }` and SHALL NOT pass the raw underlying request object. The context SHALL expose only this bounded allowlist. It SHALL include `method`, `url`, and the `dpop` header so that a sender-constrained-token resolver (DPoP, RFC 9449) can validate a proof without a later schema change; a resolver that does not use DPoP simply ignores those fields.

#### Scenario: Resolver receives only the curated context
- **WHEN** the resolution hook invokes a resolver
- **THEN** the resolver receives `method`, `url`, the authorization/cookie/dpop headers, the `isAuthenticated` boolean, and the client IP
- **AND** the resolver cannot reach request internals beyond that curated surface

#### Scenario: DPoP-bound token can be validated
- **WHEN** a resolver validates a sender-constrained (DPoP) access token
- **THEN** it can read the `dpop` proof header together with `method` and `url` from the context
- **AND** no wider request access is required

### Requirement: Resolver registration is trust-gated

The system SHALL expose a plugin registration API to add a principal resolver, and SHALL permit registration only from a plugin whose manifest priority is `<= 100`. A plugin above that threshold SHALL receive a no-op registrar and its resolver SHALL never run.

#### Scenario: Trusted plugin registers a resolver
- **WHEN** a plugin with manifest priority `<= 100` registers a resolver
- **THEN** the resolver is added to the resolution chain
- **AND** the registration call returns an unsubscribe function that removes it

#### Scenario: Untrusted plugin attempt is inert
- **WHEN** a plugin with manifest priority `> 100` attempts to register a resolver
- **THEN** no resolver is added to the chain
- **AND** no request is ever routed to that plugin for principal resolution

### Requirement: Priority-ordered first-match resolution

The system SHALL run registered resolvers in ascending priority order (lower number first) and SHALL set `request.principal` to the first non-null principal result, stopping the walk at that point. A resolver result SHALL be one of: a `Principal` (claim), `null` ("not my credential" — continue), or a distinct reject outcome ("this credential is mine and it is invalid").

#### Scenario: Lower-priority-number resolver wins
- **WHEN** two resolvers would both return a principal and one has a lower priority number
- **THEN** the lower-numbered resolver runs first and its principal is used
- **AND** the higher-numbered resolver is not consulted for that request

#### Scenario: Non-claiming resolver falls through
- **WHEN** the first resolver returns `null` for a credential it does not recognize
- **THEN** the next resolver in priority order is consulted

#### Scenario: Reject stops the chain fail-closed
- **WHEN** a resolver returns the reject outcome for a credential it owns but finds invalid (e.g. a JWT with a bad signature or expired `exp`)
- **THEN** the walk stops, `request.principal` is `null`, and no lower-priority resolver claims it
- **AND** the request MAY be answered with 401 rather than silently falling through

#### Scenario: Equal priorities tie-break by registration order with a warning
- **WHEN** two registered resolvers share the same priority number
- **THEN** they are ordered by registration (load) order
- **AND** the system logs a warning identifying the colliding resolvers

### Requirement: Resolution runs after the auth chain settles

The system SHALL run principal resolution once per request, after the existing authentication chain has settled `request.isAuthenticated`, and before any guarded route handler executes. Resolvers SHALL be resolvable to a fixed dispatch position regardless of plugin load order.

#### Scenario: Principal available to route handlers
- **WHEN** a guarded route handler executes
- **THEN** `request.principal` has already been resolved (to a principal or to `null`)

#### Scenario: Authenticated device bearer yields no principal
- **WHEN** a request is authenticated via the opaque paired-device bearer path (so `isAuthenticated` is true) and no resolver recognizes it as a person
- **THEN** `request.principal` is `null`

### Requirement: Fail-closed resolver isolation

A resolver that throws, rejects, or exceeds its time budget SHALL be treated as if it returned `null`, SHALL be logged, and SHALL NOT cause the request to fail with a server error. Resolution SHALL never itself grant authority; absence of a claim yields `null`.

#### Scenario: Throwing resolver is neutralized
- **WHEN** a resolver throws or rejects during resolution
- **THEN** it is treated as returning `null`
- **AND** the event is logged
- **AND** the request continues to the next resolver or to `null`, never a 500

#### Scenario: Slow resolver is bounded
- **WHEN** a resolver exceeds its time budget
- **THEN** it is treated as returning `null` and the walk continues

### Requirement: Default-inert behavior

With no resolver registered, the system SHALL behave exactly as before this change: `request.principal` is always `null` and no request outcome changes. The seam SHALL be safe to enable in a build that registers no resolver.

#### Scenario: No resolvers registered
- **WHEN** the server runs with zero registered principal resolvers
- **THEN** every request has `request.principal === null`
- **AND** no authentication or routing behavior differs from before the seam existed
