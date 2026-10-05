## ADDED Requirements

### Requirement: Single-issuer social-login broker
The `social-login` plugin SHALL act as one OAuth/OIDC authorization server that federates GitHub, Google and generic OIDC upstreams behind one issuer, one signing key and one JWKS, and SHALL emit tokens its own resolver verifies locally.

#### Scenario: Allowlisted upstream user signs in
- **WHEN** a user authenticates at an enabled upstream and matches an allowlist entry
- **THEN** the broker issues a dashboard-signed token whose `sub`, `email` and `tier` come from the linked account

#### Scenario: Non-allowlisted user is refused
- **WHEN** an upstream user matches no allowlist entry
- **THEN** login is refused and no default tier is granted

#### Scenario: Linked identities share a principal
- **WHEN** a user signs in via GitHub then via Google linked to the same account
- **THEN** both resolve to the same `(iss, sub)` principal

### Requirement: Issuer and callback origins from configuration
The broker SHALL derive BOTH its issuer origin (the `iss` it signs and the origin of its `.well-known` metadata) and its upstream callback origin (the redirect URI registered at GitHub/Google) from the configured public base URL, and MUST NOT use the request `Host` header for either. The settings page SHALL show the exact callback URL to register and warn when the base is ephemeral.

#### Scenario: Forged Host header
- **WHEN** a request carries a `Host` different from the configured public base
- **THEN** issued metadata, the `iss` claim and redirects still use the configured public base

#### Scenario: Callback URL matches what was registered
- **WHEN** the operator copies the callback URL from the settings page
- **THEN** it is `<public base>` plus the broker's callback path, independent of how the settings page was reached
