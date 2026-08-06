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
