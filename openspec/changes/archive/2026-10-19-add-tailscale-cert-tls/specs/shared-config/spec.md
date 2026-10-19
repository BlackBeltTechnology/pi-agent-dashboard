## MODIFIED Requirements

### Requirement: `allowedHosts` config field
The config loader SHALL support an optional top-level `allowedHosts: string[]`, filtered to string entries, defaulting to an empty list. Each entry is a bare hostname (no scheme, no port); entries are compared case-insensitively. The field is for hostnames the dashboard answers on that are not already implied by `publicBaseUrls`, `cors.allowedOrigins`, a live tunnel, a TLS-listener certificate name, an IP literal, loopback, or `.local` — an operator SHALL NOT need to duplicate a public base URL's host here.

#### Scenario: Absent field defaults to empty
- **WHEN** `config.json` has no `allowedHosts` key
- **THEN** the loaded config SHALL expose `allowedHosts` as `[]`

#### Scenario: Non-string entries are dropped
- **WHEN** `allowedHosts` is `["dash.home.arpa", 42, null]`
- **THEN** the loaded value SHALL be `["dash.home.arpa"]`

#### Scenario: Partial config writes preserve the field
- **WHEN** any runtime writer updates an unrelated key (e.g. `auth`) while `allowedHosts` is set
- **THEN** `allowedHosts` SHALL be unchanged in the written file

#### Scenario: TLS certificate names need no allowedHosts entry
- **WHEN** the TLS listener holds a certificate for `host.example.ts.net` and `allowedHosts` is `[]`
- **THEN** requests with `Host: host.example.ts.net` SHALL be admitted without adding it to `allowedHosts`
