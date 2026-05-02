## MODIFIED Requirements

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
