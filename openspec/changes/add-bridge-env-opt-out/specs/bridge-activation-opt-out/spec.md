## ADDED Requirements

### Requirement: Bridge activation resolves env over config over default
The bridge SHALL decide whether to activate exactly once per factory invocation, before any registration, using `PI_DASHBOARD_BRIDGE` and the `bridge.enabled` config field. The env value SHALL be trimmed and compared case-insensitively. A value in `{off, 0, false, no}` SHALL disable activation; a value in `{on, 1, true, yes}` SHALL enable it. Any other value (unset, empty, unrecognised) SHALL defer to `bridge.enabled` from `~/.pi/dashboard/config.json`, which defaults to `true`. When the env value is recognised, the config SHALL NOT be consulted.

#### Scenario: Env off disables regardless of config
- **WHEN** `PI_DASHBOARD_BRIDGE` is `" OFF "` and config `bridge.enabled` is `true`
- **THEN** the resolver SHALL return disabled

#### Scenario: Env on enables regardless of config
- **WHEN** `PI_DASHBOARD_BRIDGE` is `on` and config `bridge.enabled` is `false`
- **THEN** the resolver SHALL return enabled

#### Scenario: Unset env defers to config false
- **WHEN** `PI_DASHBOARD_BRIDGE` is unset and config `bridge.enabled` is `false`
- **THEN** the resolver SHALL return disabled

#### Scenario: Empty env defers to config
- **WHEN** `PI_DASHBOARD_BRIDGE` is `"  "` (whitespace only) and config `bridge.enabled` is `false`
- **THEN** the resolver SHALL return disabled

#### Scenario: Unrecognised env defers to config
- **WHEN** `PI_DASHBOARD_BRIDGE` is `maybe` and config has no `bridge` key
- **THEN** the resolver SHALL return enabled

### Requirement: Disabled bridge is fully inert
When activation resolves to disabled, the bridge factory SHALL return without calling `activateProviderRegister`, `activateRoleManager`, or `initBridge`. It SHALL NOT register any tool, command, event handler, MCP server or system-prompt contribution, SHALL NOT open a server connection, SHALL NOT attempt auto-start, and SHALL NOT emit any bridge-originated output to stdout or stderr. (The shared config loader's pre-existing file-mode hygiene is out of scope.)

#### Scenario: Opt-out leaves a user session untouched
- **WHEN** a pi process loads the bridge with `PI_DASHBOARD_BRIDGE=off`
- **THEN** `shouldActivateBridge` SHALL return `false` and the factory SHALL NOT invoke `activateProviderRegister`, `activateRoleManager` or `initBridge`
- **AND** no `session_register` SHALL reach a running dashboard server and no `dashboard-*` command SHALL be available in that session

#### Scenario: Default activation is unchanged
- **WHEN** `PI_DASHBOARD_BRIDGE` is unset and config has no `bridge` key
- **THEN** the bridge SHALL activate and register exactly as before this change

### Requirement: Activation resolution fails open
If resolving activation throws (for example the config read fails), the bridge SHALL activate as if enabled. The opt-out SHALL NOT be able to disable the bridge through an error.

#### Scenario: Resolution error activates the bridge
- **WHEN** reading the bridge activation config throws
- **THEN** the bridge SHALL proceed with normal activation

### Requirement: Server-spawned sessions force bridge activation
`buildSpawnEnv` SHALL set `PI_DASHBOARD_BRIDGE=on` in every env it returns, overwriting any inherited value. Because a tmux pane inherits the long-lived tmux server's env rather than the spawn env, `buildTmuxCommand` SHALL additionally pass `-e PI_DASHBOARD_BRIDGE=on` on every `new-window` / `new-session` it builds. Together these ensure that dashboard-spawned pi sessions — and descendant processes inheriting that env — activate the bridge regardless of `bridge.enabled` or the server's own environment. A descendant process launched with an explicitly set falsy `PI_DASHBOARD_BRIDGE` (overriding the inherited stamp) SHALL be honoured as an opt-out. Windows Terminal spawns rely on `wt.exe` propagating the spawn env; that propagation is not guaranteed by this requirement (same exposure as the existing endpoint pin on that path).

#### Scenario: Inherited off is overwritten
- **WHEN** `buildSpawnEnv` is called with a base env containing `PI_DASHBOARD_BRIDGE=off`
- **THEN** the returned env SHALL contain `PI_DASHBOARD_BRIDGE=on`
- **AND** the caller's base env object SHALL NOT be mutated

#### Scenario: Stamp present without spawn token
- **WHEN** `buildSpawnEnv` is called without a `spawnToken`
- **THEN** the returned env SHALL still contain `PI_DASHBOARD_BRIDGE=on`

#### Scenario: tmux pane receives the stamp per window
- **WHEN** `buildTmuxCommand` builds a `new-window` or a `new-session` argv, with or without a spawn token, endpoint or heap options
- **THEN** the argv SHALL contain the pair `-e`, `PI_DASHBOARD_BRIDGE=on` before `-c`
