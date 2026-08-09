## ADDED Requirements

### Requirement: OAuth redirect base input on the Security page
The Security page SHALL provide an input writing `auth.redirectBaseUrl` through the existing `PUT /api/config` path, with help text stating (a) that the value is the public origin the provider calls back to and (b) that the identical callback URL must also be registered with the OAuth provider — the config field alone is not sufficient.

An empty input SHALL be sent as an explicit empty string, which clears the override. Omitting the key from the write would PRESERVE the previous value instead, so the cleared state SHALL NOT be expressed by omission.

#### Scenario: Operator sets the redirect base
- **WHEN** the operator enters `https://pi.example.com` on the Security page and saves
- **THEN** the persisted config SHALL contain `auth.redirectBaseUrl: "https://pi.example.com"` and the next `GET /auth/start/:provider` SHALL emit that base in `redirect_uri`

#### Scenario: Operator clears the redirect base
- **WHEN** the operator empties the input and saves
- **THEN** the write SHALL carry `auth.redirectBaseUrl: ""` and redirect resolution SHALL fall back to the tunnel URL, or `http://localhost:{port}` when no tunnel is active
