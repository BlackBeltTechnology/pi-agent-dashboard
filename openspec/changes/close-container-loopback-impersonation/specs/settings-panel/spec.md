## MODIFIED Requirements

### Requirement: Config read endpoint
The server SHALL expose `GET /api/config` returning the current dashboard configuration. The endpoint SHALL be localhost-only (use `localhostGuard`). Auth secrets and provider client secrets SHALL be redacted in the response (replaced with `"***"`).

#### Scenario: Read config
- **WHEN** a localhost `GET /api/config` request carrying local proof is received (or any localhost request with `requireLocalProof` explicitly `false`)
- **THEN** the server SHALL return `{ success: true, data: <config> }` with secrets redacted

#### Scenario: Read config from external IP
- **WHEN** a non-localhost `GET /api/config` request is received
- **THEN** the server SHALL return 403

#### Scenario: Secret redaction
- **WHEN** config contains `auth.secret` or `auth.providers.github.clientSecret`
- **THEN** the response SHALL replace those values with `"***"`
