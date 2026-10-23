## ADDED Requirements

### Requirement: CSP report sink is public to the OAuth gate
The OAuth `onRequest` gate SHALL treat `POST /__pi/csp-report/:policy` as a public path, so violation reports from signed-out pages (the login and passkey pages) are neither redirected to `/auth/login` nor refused. The exemption SHALL cover only that method and path pattern; it SHALL NOT widen any other route. See the `baseline-content-security-policy` capability for the sink's own limits.

#### Scenario: Signed-out report is not redirected
- **WHEN** OAuth is configured and a request with no cookie posts a report to `/__pi/csp-report/strict`
- **THEN** the OAuth gate SHALL NOT redirect or refuse it

#### Scenario: Exemption is narrow
- **WHEN** OAuth is configured and a request with no cookie sends `GET /__pi/csp-report/strict` or posts to another `/__pi/` path
- **THEN** the OAuth gate SHALL apply as for any non-public path
