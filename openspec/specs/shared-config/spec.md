# shared-config Specification

## Purpose

Reads dashboard configuration from `~/.pi/dashboard/config.json`. Single source of truth for ports, auth, tunneling, OpenSpec polling, model proxy, plugin overrides. Loaded by server + CLI; runtime-reconfigurable via `PUT /api/config`. Provides defaults, schema validation, and partial-merge semantics.
## Requirements
### Requirement: Config file location and schema
The shared config module SHALL read configuration from `~/.pi/dashboard/config.json`. The config schema SHALL include the following fields with defaults:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | 8000 | HTTP + Browser WebSocket port |
| `piPort` | number | 9999 | Pi extension WebSocket port |
| `autoStart` | boolean | true | Whether the extension auto-starts the server |
| `autoShutdown` | boolean | true | Whether the server auto-shuts down when idle |
| `shutdownIdleSeconds` | number | 300 | Seconds to wait after last pi session disconnects before shutting down |
| `spawnStrategy` | `"tmux" \| "headless"` | `"tmux"` | Strategy for spawning new pi sessions from the dashboard |
| `tunnel.enabled` | boolean | true | Whether to create a zrok public tunnel on server startup |
| `devBuildOnReload` | boolean | false | Whether to build client and restart server on `/reload` |
| `auth` | object \| undefined | undefined | Optional OAuth authentication configuration |
| `auth.secret` | string | (auto-generated) | JWT signing secret |
| `auth.providers` | object | `{}` | Map of provider name → credentials |
| `auth.allowedUsers` | string[] | `[]` | User allowlist: emails, usernames, or `*@domain` wildcards. Empty = allow all |
| `lastServer` | string \| undefined | undefined | Last-used server address (`host:port`) for reconnection |

Invalid `spawnStrategy` values SHALL fall back to `"tmux"`.

When `auth` is undefined or not present, authentication SHALL be completely disabled.

#### Scenario: Config with all fields present
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "port": 3000, "piPort": 4000, "autoStart": false }`
- **THEN** `loadConfig()` SHALL return those values with defaults for omitted fields

#### Scenario: Config with partial fields
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "port": 3000 }`
- **THEN** `loadConfig()` SHALL return `port: 3000` with all other fields at their defaults

#### Scenario: Empty or missing config
- **WHEN** `~/.pi/dashboard/config.json` does not exist or is empty
- **THEN** `loadConfig()` SHALL return all default values with `auth` as undefined

#### Scenario: Config with auto-shutdown fields
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "autoShutdown": false, "shutdownIdleSeconds": 60 }`
- **THEN** `loadConfig()` SHALL return those values with defaults for all other fields

#### Scenario: Config with devBuildOnReload enabled
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "devBuildOnReload": true }`
- **THEN** `loadConfig()` SHALL return `devBuildOnReload: true` with defaults for all other fields

#### Scenario: Config without devBuildOnReload
- **WHEN** `~/.pi/dashboard/config.json` does not include `devBuildOnReload`
- **THEN** `loadConfig()` SHALL return `devBuildOnReload: false`

#### Scenario: Invalid spawnStrategy
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "spawnStrategy": "invalid" }`
- **THEN** `loadConfig()` SHALL return `spawnStrategy: "tmux"` (fallback to default)

#### Scenario: ensureConfig creates defaults
- **WHEN** `ensureConfig()` is called and no config file exists
- **THEN** it SHALL create the config directory recursively and write all defaults to the file (without `auth` key)

#### Scenario: Config with auth section
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "auth": { "secret": "abc", "providers": { "github": { "clientId": "x", "clientSecret": "y" } } } }`
- **THEN** `loadConfig()` SHALL return the `auth` object with the provider configuration intact

#### Scenario: Config with auth but no providers
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "auth": { "providers": {} } }`
- **THEN** `loadConfig()` SHALL return `auth` as undefined (empty providers = auth disabled)

#### Scenario: Config with allowedUsers
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "auth": { ..., "allowedUsers": ["octocat", "user@example.com", "*@company.com"] } }`
- **THEN** `loadConfig()` SHALL return `auth.allowedUsers` as `["octocat", "user@example.com", "*@company.com"]`

#### Scenario: Config with lastServer
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "lastServer": "workstation.local:8000" }`
- **THEN** `loadConfig()` SHALL return `lastServer: "workstation.local:8000"`

#### Scenario: Config without lastServer
- **WHEN** `~/.pi/dashboard/config.json` does not include `lastServer`
- **THEN** `loadConfig()` SHALL return `lastServer: undefined`

### Requirement: Config file schema additions for Electron
The shared config module SHALL include a new field:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `electronMode` | boolean | false | Whether the server was launched by the Electron app |

#### Scenario: Config with electronMode
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "electronMode": true }`
- **THEN** `loadConfig()` SHALL return `electronMode: true`

#### Scenario: Empty or missing electronMode
- **WHEN** `~/.pi/dashboard/config.json` does not include `electronMode`
- **THEN** `loadConfig()` SHALL return `electronMode: false`

#### Scenario: ensureConfig excludes electronMode
- **WHEN** `ensureConfig()` creates a new config file
- **THEN** it SHALL NOT include `electronMode` in the written defaults

### Requirement: Reattach placement config field
The shared config module SHALL include a new field that governs how the server places re-registering bridges in `sessionOrder` after a dashboard restart:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `reattachPlacement` | `"preserve" \| "streaming-only" \| "always"` | `"always"` | Policy applied when a bridge sends `session_register` with `registerReason: "reattach"` |

Invalid values (anything outside the union) SHALL fall back to the default `"always"`.

`ensureConfig()` SHALL NOT include `reattachPlacement` in the written defaults — the loader's default-coalescing handles missing values, keeping the on-disk file minimal.

#### Scenario: Config with reattachPlacement preserve
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "reattachPlacement": "preserve" }`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "preserve"`

#### Scenario: Config with reattachPlacement streaming-only
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "reattachPlacement": "streaming-only" }`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "streaming-only"`

#### Scenario: Config with reattachPlacement always
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "reattachPlacement": "always" }`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "always"`

#### Scenario: Empty or missing reattachPlacement defaults to always
- **WHEN** `~/.pi/dashboard/config.json` does not include `reattachPlacement`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "always"`

#### Scenario: Invalid reattachPlacement falls back to always
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "reattachPlacement": "wibble" }`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "always"`

#### Scenario: ensureConfig excludes reattachPlacement
- **WHEN** `ensureConfig()` creates a new config file
- **THEN** it SHALL NOT include `reattachPlacement` in the written defaults

### Requirement: ask_user prompt timeout config field
The shared config module SHALL include a configurable timeout that governs how long the bridge's PromptBus waits for a response to an interactive `ask_user` (or any other PromptBus-routed) prompt before auto-cancelling:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `askUserPromptTimeoutSeconds` | number | 300 | Seconds to wait for an answer before auto-cancelling. Any value `<= 0` (canonically `-1`) SHALL disable the timeout entirely so prompts wait indefinitely. |

The shared config module SHALL also export a `DEFAULT_ASK_USER_PROMPT_TIMEOUT_SECONDS` constant equal to `300` so consumers (CLI, electron, tests) reference the same value rather than re-hard-coding it.

Non-numeric values (string, boolean, null, arrays, objects) SHALL fall back to the default `300`.

`ensureConfig()` SHALL NOT include `askUserPromptTimeoutSeconds` in the written defaults — the loader's default-coalescing handles missing values, keeping the on-disk file minimal.

#### Scenario: Config with default timeout
- **WHEN** `~/.pi/dashboard/config.json` does not include `askUserPromptTimeoutSeconds`
- **THEN** `loadConfig()` SHALL return `askUserPromptTimeoutSeconds: 300`

#### Scenario: Config with custom positive timeout
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "askUserPromptTimeoutSeconds": 60 }`
- **THEN** `loadConfig()` SHALL return `askUserPromptTimeoutSeconds: 60`

#### Scenario: Config with infinite timeout via -1
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "askUserPromptTimeoutSeconds": -1 }`
- **THEN** `loadConfig()` SHALL return `askUserPromptTimeoutSeconds: -1` (not coerced to the default — the negative value is preserved as the disable-timeout signal)

#### Scenario: Config with infinite timeout via 0
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "askUserPromptTimeoutSeconds": 0 }`
- **THEN** `loadConfig()` SHALL return `askUserPromptTimeoutSeconds: 0`

#### Scenario: Non-numeric value falls back to default
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "askUserPromptTimeoutSeconds": "forever" }` (or `null`, or an object/array)
- **THEN** `loadConfig()` SHALL return `askUserPromptTimeoutSeconds: 300`

#### Scenario: ensureConfig excludes askUserPromptTimeoutSeconds
- **WHEN** `ensureConfig()` creates a new config file
- **THEN** it SHALL NOT include `askUserPromptTimeoutSeconds` in the written defaults

### Requirement: Configurable spawn-register watchdog timeout
`packages/shared/src/config.ts` SHALL accept a new optional config field `spawnRegisterTimeoutMs: number` in the dashboard config schema loaded from `~/.pi/dashboard/config.json`. The default value SHALL be `30000` (30 seconds). Values SHALL be clamped to the inclusive range `[5000, 120000]` at read time. Non-number / NaN / missing values SHALL fall back to the default.

#### Scenario: default applied when field omitted
- **WHEN** the config file does not contain `spawnRegisterTimeoutMs`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 30000`

#### Scenario: in-range value preserved
- **WHEN** the config file contains `"spawnRegisterTimeoutMs": 45000`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 45000`

#### Scenario: below-range value clamped
- **WHEN** the config file contains `"spawnRegisterTimeoutMs": 1000`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 5000`

#### Scenario: above-range value clamped
- **WHEN** the config file contains `"spawnRegisterTimeoutMs": 999999`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 120000`

#### Scenario: invalid value falls back to default
- **WHEN** the config file contains `"spawnRegisterTimeoutMs": "thirty"` or `null` or `NaN`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 30000`

### Requirement: `openspec.enabled` config field gates OpenSpec functionality globally
The shared config schema SHALL include an optional boolean field `openspec.enabled` with default value `true`. When `false`, the dashboard SHALL treat OpenSpec as fully disabled — no polling, no UI surfaces. Other `openspec.*` poll-tuning fields (`pollIntervalSeconds`, `maxConcurrentSpawns`, `changeDetection`, `jitterSeconds`) SHALL retain their meaning but be ignored at runtime when `enabled === false`.

The field SHALL be parseable by `parseOpenSpecPollConfig` and round-trip through `~/.pi/dashboard/config.json` reads/writes. Invalid (non-boolean) values SHALL fall back to the default `true`. Existing config files without the field SHALL behave exactly as today.

#### Scenario: Default value is true when field absent
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "openspec": { "pollIntervalSeconds": 60 } }` (no `enabled` key)
- **THEN** `loadConfig().openspec.enabled` SHALL be `true`

#### Scenario: Explicit false is preserved
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "openspec": { "enabled": false } }`
- **THEN** `loadConfig().openspec.enabled` SHALL be `false`
- **AND** other `openspec.*` fields SHALL retain their default values

#### Scenario: Non-boolean value falls back to default
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "openspec": { "enabled": "yes" } }`
- **THEN** `loadConfig().openspec.enabled` SHALL be `true`

#### Scenario: Round-trip via PUT /api/config
- **WHEN** a `PUT /api/config` request sets `{ "openspec": { "enabled": false } }`
- **THEN** the value SHALL persist to `~/.pi/dashboard/config.json`
- **AND** subsequent `GET /api/config` SHALL return `openspec.enabled === false`

### Requirement: `keeperLog.capturePiOutput` config field gates keeper pi-output capture
The config SHALL support a `keeperLog` object with a boolean `capturePiOutput` field that controls whether per-session keepers archive pi's stdout/stderr into `keeper-<sessionId>.log`. `loadConfig` SHALL default `keeperLog` to `{ capturePiOutput: false }` (capture OFF) when the field is absent. A non-object `keeperLog` or a non-boolean `capturePiOutput` SHALL fall back to the default. `ensureConfig` SHALL NOT write `keeperLog` into the on-disk defaults (absent field implies capture OFF).

#### Scenario: Default value is false when field absent
- **WHEN** `loadConfig` reads a config with no `keeperLog` key
- **THEN** the resolved config SHALL have `keeperLog.capturePiOutput === false`

#### Scenario: Explicit true is preserved
- **WHEN** the config file contains `{ "keeperLog": { "capturePiOutput": true } }`
- **THEN** the resolved config SHALL have `keeperLog.capturePiOutput === true`

#### Scenario: Non-boolean value falls back to default
- **WHEN** the config file contains `{ "keeperLog": { "capturePiOutput": "yes" } }`
- **THEN** the resolved config SHALL have `keeperLog.capturePiOutput === false`

#### Scenario: Round-trip via PUT /api/config
- **WHEN** a client PUTs `{ "keeperLog": { "capturePiOutput": true } }` to `/api/config`
- **THEN** the value SHALL be persisted and returned on the next config read

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

