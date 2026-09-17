## Purpose

A default resolver plugin, bundled with the dashboard and registered against the principal-resolution seam, that validates a Keycloak JWT access token as a resource server per RFC 9068 and reads every Keycloak connection value from settings so that nothing about the identity provider is hardcoded.

## ADDED Requirements

### Requirement: Keycloak connection is entirely config-seeded

The resolver SHALL read every Keycloak-specific value from plugin settings via the host `getPluginConfig()` mechanism and SHALL NOT hardcode any issuer, realm, hostname, port, client id, audience, or signing key. At minimum the settings SHALL provide the issuer URL; they MAY provide expected audience, authorized party (client id), an explicit JWKS URI override, and a clock-skew tolerance. When the required settings are absent, the resolver SHALL register but resolve every request to `null` (inert), never a hardcoded fallback.

#### Scenario: Issuer seeded from settings
- **WHEN** the plugin is configured with an issuer URL (for example a Docker Keycloak `http://keycloak:8080/realms/<realm>`)
- **THEN** the resolver uses exactly that configured issuer for discovery and `iss` validation
- **AND** no issuer, realm, or port value is taken from a compiled-in default

#### Scenario: Missing configuration is inert, not defaulted
- **WHEN** the plugin has no issuer configured
- **THEN** the resolver returns `null` for every request
- **AND** it never substitutes a hardcoded issuer or key

### Requirement: Resource-server validation per RFC 9068

The resolver SHALL treat the `Authorization: Bearer` value as a JWT access token and validate it as a resource server: verify the RS256 signature against the issuer's JWKS, and verify `iss` equals the configured issuer, `aud` includes the configured audience, `azp` equals the configured authorized party when configured, and `exp` is in the future within the configured clock skew. On success the resolver SHALL return a principal of `{ iss, sub, email? }` taken from the verified claims. On a bearer it owns but that fails any check, it SHALL return the reject outcome.

#### Scenario: Valid Keycloak token resolves to a principal
- **WHEN** a request carries a Keycloak JWT whose signature, `iss`, `aud`, `azp`, and `exp` all pass against the configured values
- **THEN** the resolver returns `{ iss, sub, email? }` from the verified claims

#### Scenario: Invalid token is rejected, not passed through
- **WHEN** a request carries a JWT whose signature is invalid or whose `exp` has passed
- **THEN** the resolver returns the reject outcome so the chain stops fail-closed

### Requirement: JWKS is discovered and cached

The resolver SHALL obtain the signing keys by performing OIDC discovery from the configured issuer to read `jwks_uri` (or use the configured JWKS URI override) and SHALL cache the JWKS, refreshing on an unknown key id or a configured interval. It SHALL NOT depend on the host's `fetchOIDCDiscovery`, which omits `jwks_uri`.

#### Scenario: JWKS cached across requests
- **WHEN** the resolver has fetched the issuer's JWKS once
- **THEN** subsequent requests validate against the cached keys without a network fetch
- **AND** an unrecognized key id triggers a single refresh

### Requirement: Disambiguation from the opaque device bearer

The resolver SHALL attempt JWT validation first; when the bearer is not a well-formed JWT (for example an opaque paired-device token), it SHALL return `null` so the request falls through to the existing device path. A device bearer SHALL NEVER resolve to a principal.

#### Scenario: Opaque device token falls through
- **WHEN** a request carries an opaque paired-device bearer rather than a JWT
- **THEN** the resolver returns `null` and the existing device authentication path handles it
- **AND** `request.principal` is not set by this resolver

### Requirement: Issuer must match the login connector when both use Keycloak

When the dashboard's existing login connector (`auth.providers.keycloak`) points at the same realm, the resolver's configured issuer SHALL be the same issuer string, because `iss` is the persisted identity join key and a hostname or port mismatch silently breaks every stored `(iss, sub)`. The resolver SHALL validate `iss` by exact match against its configured issuer and SHALL NOT accept a differently-spelled but logically-equivalent issuer.

#### Scenario: Mismatched issuer is refused
- **WHEN** a token's `iss` does not exactly equal the configured issuer
- **THEN** the resolver returns the reject outcome
- **AND** no principal is produced from a non-matching issuer
