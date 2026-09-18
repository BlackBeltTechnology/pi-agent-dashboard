## Purpose

A resolver shipped as a bundled dashboard plugin (`keycloak-resolver`, default-enabled, in `BUNDLED_PLUGINS`) that validates a Keycloak JWT access token as an OAuth resource server (RFC 9068) and reads every deployment-specific Keycloak value from settings, so nothing about the identity provider is hardcoded and dashboard core imports nothing Keycloak-specific. It is replaceable by an override plugin (disable the default + trust the replacement).

## ADDED Requirements

### Requirement: Keycloak connection is entirely config-seeded

The resolver SHALL read every Keycloak-specific value from settings via `getPluginConfig()` and SHALL NOT hardcode any issuer, realm, hostname, port, client id, audience, or key. Required settings to activate: `issuer`, `audience`. Optional: `authorizedParty`, `jwksUri`, `clockSkewSeconds` (default 30), `networkTimeoutMs` (default 2000), `allowInsecureHttp` (default false). When required settings are absent, the resolver SHALL register but resolve every request to `null` (inert), never a hardcoded fallback.

#### Scenario: Issuer seeded from settings
- **WHEN** the resolver is configured with an issuer (e.g. a Docker `http://keycloak:8080/realms/<realm>`)
- **THEN** it uses exactly that issuer for discovery and `iss` validation
- **AND** no issuer, realm, or port comes from a compiled-in default

#### Scenario: Missing configuration is inert
- **WHEN** no issuer/audience is configured
- **THEN** the resolver returns `null` for every request and substitutes no default

#### Scenario: Insecure HTTP requires an explicit opt-in
- **WHEN** the configured issuer or JWKS URL uses `http:` and `allowInsecureHttp` is not true
- **THEN** the resolver treats the configuration as unusable and resolves `null`
- **AND** only an explicit `allowInsecureHttp: true` permits plaintext for controlled development

### Requirement: Safe token ownership disambiguation

The resolver SHALL claim only tokens for its configured issuer. An opaque or non-JWT bearer SHALL yield `null`. A well-formed JWT whose unverified `iss` differs from the configured issuer SHALL yield `null` so another trusted resolver may claim it. A JWT whose `iss` equals the configured issuer SHALL be owned by this resolver, and any validation failure on it SHALL yield reject, never `null`.

#### Scenario: Opaque device token falls through
- **WHEN** a request carries an opaque paired-device bearer
- **THEN** the resolver returns `null` and never sets a principal

#### Scenario: Foreign-issuer JWT falls through
- **WHEN** a request carries a JWT whose `iss` is a different issuer
- **THEN** the resolver returns `null`, leaving it for another resolver

#### Scenario: Owned invalid token is rejected, not passed through
- **WHEN** a request carries a JWT claiming the configured issuer but with a bad signature or expired `exp`
- **THEN** the resolver returns reject so the chain stops fail-closed

#### Scenario: Owned-token validation faults are caught as reject, not thrown
- **WHEN** signature/JWKS/DPoP validation of an owned token raises an internal error
- **THEN** the resolver catches it and returns reject for that owned token
- **AND** it does not let the error propagate as an uncaught throw (which core would coerce to `null` and pass through)

### Requirement: Resource-server validation per RFC 9068

For an owned token the resolver SHALL verify: the signature uses the allowed algorithm RS256 against the issuer's JWKS; `iss` equals the configured issuer exactly; `aud` includes the configured audience; `azp` equals the configured authorized party when configured; `exp` is in the future within the clock skew; and `sub` is present. On success it SHALL return `{ principal: { iss, sub, email? }, expiresAt }` with `expiresAt` from `exp`, including `email` only when it is a string and `email_verified` is true.

#### Scenario: Valid Keycloak token resolves to a principal with expiry
- **WHEN** a request carries a Keycloak JWT passing signature, `iss`, `aud`, `azp`, `exp`, and `sub`
- **THEN** the resolver returns the principal and `expiresAt` from `exp`

#### Scenario: Algorithm confusion is rejected
- **WHEN** an owned token is presented with a non-RS256 or `none` algorithm
- **THEN** the resolver rejects it rather than accepting an unverified signature

#### Scenario: Unverified email is not exposed as a label
- **WHEN** an owned token's `email_verified` is false or absent
- **THEN** the returned principal carries no `email`

### Requirement: DPoP proof validated when the token is sender-constrained

DPoP is conditional on the token being sender-constrained. When an owned token carries a `cnf.jkt` confirmation, the resolver SHALL validate the DPoP proof (RFC 9449): the proof JWS signature verifies under its embedded `jwk`; the SHA-256 thumbprint of that `jwk` equals `cnf.jkt`; `htm` equals the request method; `htu` equals the canonical request URL (scheme/host/port from configured public base or trusted proxy, query and fragment stripped); `ath` equals the base64url-encoded SHA-256 of the presented access token; `iat` is within the freshness window; and `jti` is unreused within that window. An absent, unsigned, or any-element-mismatched proof SHALL reject. A token without `cnf.jkt` SHALL be validated as an ordinary bearer, so a realm that issues unbound tokens works unchanged. The `jti` replay window is enforced within a single dashboard instance; cross-instance replay defense is out of scope.

#### Scenario: Missing DPoP proof for a bound token is rejected
- **WHEN** an owned token has `cnf.jkt` but the request carries no valid `dpop` proof
- **THEN** the resolver rejects the token

#### Scenario: Proof not bound to the presented token is rejected
- **WHEN** a DPoP proof is otherwise well-formed but its `ath` does not match the SHA-256 of the presented access token
- **THEN** the resolver rejects the token, because the proof is not bound to this token

### Requirement: JWKS is discovered, cached, and coalesced

The resolver SHALL obtain keys by OIDC discovery from the configured issuer (or the configured `jwksUri`) and SHALL cache the JWKS. Refreshes SHALL be coalesced so concurrent misses trigger at most one fetch, and an unknown `kid` SHALL trigger at most one refresh per in-flight generation. Discovery/JWKS fetches SHALL obey `networkTimeoutMs`. The resolver SHALL NOT depend on the host's `fetchOIDCDiscovery`, which omits `jwks_uri`.

#### Scenario: JWKS cached across requests
- **WHEN** the resolver has fetched the JWKS once
- **THEN** subsequent requests validate against cached keys without a network fetch
- **AND** an unrecognized `kid` triggers a single coalesced refresh

#### Scenario: Discovery outage denies rather than accepts
- **WHEN** JWKS/discovery is unreachable within the timeout and no usable cached key exists
- **THEN** owned tokens are rejected rather than accepted unverified

### Requirement: An active resolver excludes confidential login connectors

When the resolver is active (enabled and configured), a non-empty `auth.providers` (the confidential code→cookie login connectors) SHALL be a startup configuration error, because that path is not a resource-server validator and would create a second principal source and a principal-less cookie bypass. While the resolver is inert the connectors are unaffected.

#### Scenario: Active resolver plus connectors fails startup
- **WHEN** the resolver is active and `auth.providers` is non-empty
- **THEN** startup fails with a configuration error before `listen()`

### Requirement: Issuer is pinned and matched exactly

The resolver SHALL validate `iss` by exact string match against its configured issuer and SHALL NOT accept a differently-spelled but logically-equivalent issuer, because `iss` is half the persisted `(iss, sub)` ownership key and a hostname/scheme/port drift silently orphans stored ownership.

#### Scenario: Mismatched issuer is refused
- **WHEN** an owned token's `iss` does not exactly equal the configured issuer
- **THEN** the resolver rejects it and produces no principal
