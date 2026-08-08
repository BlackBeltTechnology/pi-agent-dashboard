## ADDED Requirements

### Requirement: `auth.redirectBaseUrl` config field
The config loader SHALL support an optional `auth.redirectBaseUrl` string field that supplies the base URL for OAuth redirect URIs. The field SHALL be trimmed on read; a blank-after-trim value, a non-string value, or an absent key SHALL all result in `redirectBaseUrl` being `undefined` on the returned `AuthConfig`. The field SHALL NOT be seeded with a default by `ensureConfig()`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `auth.redirectBaseUrl` | string \| undefined | undefined | Base URL for OAuth redirect URIs; overrides the tunnel URL when set |

#### Scenario: Field present
- **WHEN** the config file contains `{ "auth": { "providers": {...}, "redirectBaseUrl": "https://pi.example.com" } }`
- **THEN** `loadConfig().auth.redirectBaseUrl` SHALL be `"https://pi.example.com"`

#### Scenario: Surrounding whitespace is trimmed
- **WHEN** the value is `"  https://pi.example.com/  "`
- **THEN** `loadConfig().auth.redirectBaseUrl` SHALL be `"https://pi.example.com/"`

#### Scenario: Blank value is omitted
- **WHEN** the value is `""` or `"   "`
- **THEN** `loadConfig().auth.redirectBaseUrl` SHALL be `undefined`

#### Scenario: Non-string value is omitted
- **WHEN** the value is a number, boolean, array, object, or `null`
- **THEN** `loadConfig().auth.redirectBaseUrl` SHALL be `undefined` and `loadConfig()` SHALL NOT throw

#### Scenario: Field absent
- **WHEN** the `auth` section exists without a `redirectBaseUrl` key
- **THEN** `loadConfig().auth.redirectBaseUrl` SHALL be `undefined` and every other auth field SHALL parse unchanged

#### Scenario: Defaults are not seeded
- **WHEN** `ensureConfig()` writes a fresh config file
- **THEN** the written file SHALL NOT contain a `redirectBaseUrl` key

### Requirement: `auth.redirectBaseUrl` survives partial config writes
`writeConfigPartial` SHALL merge `auth.redirectBaseUrl` from an incoming partial when the key is present (including an explicit empty string, which clears it), and SHALL preserve the previously persisted value when the key is absent from the partial.

#### Scenario: Set via partial write
- **WHEN** `PUT /api/config` sends `{ "auth": { "redirectBaseUrl": "https://pi.example.com" } }`
- **THEN** the persisted config file SHALL contain that value and SHALL retain the existing `auth.secret`, `auth.providers`, `auth.allowedUsers`, `auth.bypassUrls`, and `auth.bypassHosts`

#### Scenario: Preserved by an unrelated auth write
- **WHEN** `PUT /api/config` sends an `auth` partial without a `redirectBaseUrl` key
- **THEN** the persisted `auth.redirectBaseUrl` SHALL be unchanged

#### Scenario: Cleared by an explicit empty value
- **WHEN** `PUT /api/config` sends `{ "auth": { "redirectBaseUrl": "" } }`
- **THEN** the persisted value SHALL be the empty string and `loadConfig()` SHALL report `redirectBaseUrl` as `undefined`

### Requirement: `publicBaseUrls` promoted to top level with a legacy fallback
The config loader SHALL support an optional top-level `publicBaseUrls: string[]`, filtered to string entries, and SHALL expose a resolver returning the top-level list when present and the legacy `pairing.publicBaseUrls` when it is absent.

The key SHALL NOT be added to the defaults and SHALL NOT be seeded by `ensureConfig()`. Absence is load-bearing: it is what selects the legacy fallback, so an empty-array default would make "unset" and "set but empty" indistinguishable and orphan an existing operator's entries.

A value inherited from the legacy key SHALL feed the pairing and endpoint surfaces only, and SHALL NOT become an OAuth source. Promotion is opt-in, because the legacy key was populated to answer a different question.

#### Scenario: Top-level key present
- **WHEN** the config holds `publicBaseUrls: ["https://pi.example.com"]`
- **THEN** the resolver SHALL return that list

#### Scenario: Legacy key only
- **WHEN** the config holds only `pairing.publicBaseUrls`
- **THEN** the resolver SHALL return the legacy list and `loadConfig().publicBaseUrls` SHALL be `undefined`

#### Scenario: Both keys present
- **WHEN** both keys are present
- **THEN** the top-level list SHALL win for every consumer

#### Scenario: Present but empty is not absent
- **WHEN** the top-level key is an empty array and the legacy key is non-empty
- **THEN** the resolver SHALL return the empty list, not the legacy one

#### Scenario: No default is written
- **WHEN** `ensureConfig()` writes a fresh config file
- **THEN** the file SHALL NOT contain a top-level `publicBaseUrls` key

### Requirement: Gateway provenance records
The config loader SHALL support an optional top-level `gateways` array of `{ url, authModes[], wrote{} }` records describing each operator-declared gateway URL and the exact values the "add gateway URL" action wrote for it, so removal reverses exactly those values.

Unknown auth modes SHALL be filtered out and malformed entries SHALL be skipped rather than throwing. The key SHALL NOT be defaulted or seeded.

#### Scenario: Record round-trips
- **WHEN** the config holds a gateway record with recorded `publicBaseUrls`, `corsAllowedOrigins`, `authRedirectBaseUrl` and `trustedNetworks`
- **THEN** `loadConfig().gateways` SHALL return them unchanged

#### Scenario: Malformed entry is skipped
- **WHEN** an entry has no `url`, or carries an unknown auth mode
- **THEN** the entry SHALL be dropped, or the unknown mode filtered, and `loadConfig()` SHALL NOT throw

### Requirement: Live config reads for CORS and the network guard
The CORS origin decision and the network guard's trusted-network check SHALL read current configuration at request time, not a boot snapshot, so an origin or CIDR written at runtime applies with no restart.

The read SHALL be an mtime-gated snapshot: the config file's stat is checked on each call and the file reparsed only when it changed. The cache SHALL NOT be converted into a boot-time snapshot, and SHALL NOT rely solely on invalidate-on-write, because a hand-edited `config.json` never passes through the writer.

The runtime auth reload SHALL merge the top-level `trustedNetworks` exactly as boot does, so an auth-carrying config write cannot silently drop them until restart.

#### Scenario: Origin added at runtime
- **WHEN** an origin is added to `cors.allowedOrigins` while the server is running
- **THEN** the next preflight from that origin SHALL be allowed with no restart

#### Scenario: Trusted network added at runtime
- **WHEN** a CIDR is added to `trustedNetworks` while the server is running
- **THEN** the next request from that range SHALL be admitted with no restart

#### Scenario: Unchanged config is parsed once
- **WHEN** many requests are served with the config file unchanged
- **THEN** exactly one read-and-parse SHALL occur

#### Scenario: Mid-run rewrite is observed
- **WHEN** the config file is rewritten by any writer, including a hand edit
- **THEN** subsequent reads SHALL observe the new value without an explicit invalidation

#### Scenario: Auth reload preserves top-level trusted networks
- **WHEN** the server booted with a top-level `trustedNetworks` entry and any auth reload runs
- **THEN** an address in that range SHALL still bypass the auth gate
