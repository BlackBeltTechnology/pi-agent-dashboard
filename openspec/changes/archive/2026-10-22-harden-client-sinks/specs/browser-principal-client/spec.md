# Spec Delta

## ADDED Requirements

### Requirement: OIDC discovery endpoints are scheme-validated
This applies to the login flow bundled with the dashboard's own client, not to independent frontends. Before navigating to an authorization or end-session endpoint, or sending a token request, that flow SHALL check the `authorization_endpoint`, `token_endpoint`, and `end_session_endpoint` taken from the issuer's discovery document. Each SHALL be `https:`, or `http:` only on a loopback host. Any other value SHALL fail as a discovery failure, with no navigation and no token request.

#### Scenario: javascript authorization endpoint
- **WHEN** the discovery document returns `"authorization_endpoint": "javascript:alert(document.domain)//"`
- **THEN** sign-in fails as a discovery failure
- **AND** the browser does not navigate and no script runs in the dashboard origin

#### Scenario: javascript end-session endpoint
- **WHEN** the user signs out and the discovery document returns `"end_session_endpoint": "javascript:alert(1)//"`
- **THEN** sign-out fails as a discovery failure and the browser does not navigate to it

#### Scenario: Non-https token endpoint on a public host
- **WHEN** the discovery document returns `"token_endpoint": "http://idp.example.com/token"`
- **THEN** sign-in fails as a discovery failure and no token request is sent

#### Scenario: Loopback development issuer
- **WHEN** the discovery document returns `http://127.0.0.1:8080/realms/dev/protocol/openid-connect/auth`, `…/token`, and `…/logout`
- **THEN** sign-in and sign-out proceed normally

#### Scenario: Standard https issuer
- **WHEN** the discovery document returns `https:` endpoints on the issuer's host, another host, or the dashboard's own host
- **THEN** sign-in and sign-out proceed normally
