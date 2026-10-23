## MODIFIED Requirements

### Requirement: Every /mcp request is authenticated, including loopback
The endpoint SHALL require a valid token on every request, presented as
`Authorization: Bearer <token>`. `/mcp` SHALL NOT honour the loopback allowance
that exempts genuinely-local requests from authentication on other routes. That
allowance SHALL remain as defined for all other routes by `trust-and-credential-boundaries` "Opt-in local proof for loopback trust" (under the default it needs local proof except on `observe`-tier routes). The endpoint SHALL NOT
introduce an OAuth flow and SHALL NOT bind an OAuth callback port.

#### Scenario: Missing or invalid credential is refused
- **WHEN** a request arrives with no `Authorization` header, or with a token that is not valid
- **THEN** the server SHALL reject the request
- **AND** it SHALL NOT execute any tool

#### Scenario: Loopback does not bypass authentication
- **WHEN** a request to `/mcp` originates from a genuinely-local address with no `Authorization` header
- **THEN** the server SHALL reject the request

#### Scenario: Other routes retain the loopback allowance
- **WHEN** a genuinely-local request is made to a non-`/mcp` route that the local-trust rule admits (an `observe`-tier route, or any route with local proof, or any route with `requireLocalProof` explicitly `false`)
- **THEN** that request SHALL continue to be allowed

#### Scenario: Revoked credential loses access immediately
- **WHEN** a credential is revoked
- **AND** a subsequent `/mcp` request presents it
- **THEN** the request SHALL be refused

#### Scenario: Credential is required per request, not per connection
- **WHEN** a client sends a second request without an `Authorization` header after a successful authenticated request
- **THEN** the second request SHALL be refused
