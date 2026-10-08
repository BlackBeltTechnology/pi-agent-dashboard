## MODIFIED Requirements

### Requirement: `PI_DASHBOARD_SPAWN_TOKEN` env-var injected on every spawn
For every invocation of `spawnPiSession()` — regardless of strategy (`tmux`, `wt`, `wsl-tmux`, `headless`) and regardless of platform — the server SHALL inject `PI_DASHBOARD_SPAWN_TOKEN` (a freshly-minted UUIDv4) into the spawned process's environment via `buildSpawnEnv`. The injection SHALL be the only mechanism by which the spawn token reaches the spawned pi process; the token SHALL NOT be passed via argv, the session JSONL file, or any other channel.

The `buildSpawnEnv(baseEnv, opts?)` function SHALL accept an optional `spawnToken: string` argument and SHALL set `result.PI_DASHBOARD_SPAWN_TOKEN = spawnToken` when provided. The existing `prependManagedNodeToPath` and other env-shaping behaviors SHALL be preserved unchanged, with one exception: a heap-sizing flag the dashboard stamped into its own environment SHALL be removed from the child environment, per the heap-limits capability. A heap flag the operator pinned themselves SHALL be preserved. The pre-existing env-shaping exclusions stand unchanged — the parent-identity markers `PI_DASHBOARD_ELECTRON` and `PI_DASHBOARD_RESOURCES_PATH` are still removed so a stale identity cannot leak to a grandchild, and `ELECTRON_RUN_AS_NODE` is still shaped by argv. Additionally, the context-mode bridge-internal variables `CONTEXT_MODE_BRIDGE_DEPTH` and `CONTEXT_MODE_BRIDGE_IDLE_MS` SHALL be removed from the child environment of every strategy (for tmux-hosted strategies, also from the pane process, whose environment otherwise comes from the long-lived tmux server), so a server started from inside a context-mode sandbox does not disable context-mode's tools in the sessions it spawns. Names that a context-mode settings bridge recorded as plugin-projected SHALL also be removed, so that the current settings file, not a stale ancestor value, decides them. The dashboard-stamped heap flag, the context-mode bridge-internal variables, and recorded plugin-projected names are the only sanctioned NEW subtractions. Beyond those, no inherited variable SHALL be dropped. Variables contributed by trusted plugins (plugin-spawn-env-contributor capability) are additions. They never replace a variable inherited from the dashboard server's environment, although for tmux-hosted strategies they may override a value present only in the tmux server's global environment.

#### Scenario: Headless spawn injects token
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", spawnToken: "tok_h" })` is called on Linux or macOS
- **THEN** the spawned `sh -c "sleep ... | pi --mode rpc"` process SHALL have `PI_DASHBOARD_SPAWN_TOKEN=tok_h` in its environment
- **AND** the bridge running inside that pi process SHALL be able to read the token via `process.env.PI_DASHBOARD_SPAWN_TOKEN`

#### Scenario: Tmux spawn injects token
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux", spawnToken: "tok_t" })` is called
- **THEN** the spawned tmux pane's pi process SHALL have `PI_DASHBOARD_SPAWN_TOKEN=tok_t` in its environment
- **AND** the bridge running inside that pi process SHALL be able to read the token

#### Scenario: Windows headless injects token
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", spawnToken: "tok_w" })` is called on Windows
- **THEN** the directly-spawned `pi` process SHALL have `PI_DASHBOARD_SPAWN_TOKEN=tok_w` in its environment

#### Scenario: WT and WSL-tmux strategies inject token
- **WHEN** `spawnPiSession(cwd, { strategy: "wt", spawnToken: "tok_x" })` or `{ strategy: "wsl-tmux", spawnToken: "tok_y" }` is called
- **THEN** the spawned terminal-hosted pi process SHALL have `PI_DASHBOARD_SPAWN_TOKEN` in its environment

#### Scenario: Existing env vars preserved
- **WHEN** the dashboard server's environment contains `PATH`, `HOME`, `PI_DASHBOARD_URL`, etc.
- **THEN** the spawned process SHALL receive all of those vars unchanged in addition to `PI_DASHBOARD_SPAWN_TOKEN`

#### Scenario: Dashboard-stamped heap flag is withheld
- **WHEN** the dashboard server's environment carries the heap flag it stamped for itself
- **THEN** the spawned process's environment SHALL NOT carry that flag
- **AND** every other inherited variable SHALL still be passed through unchanged, apart from the pre-existing parent-identity exclusions and the other sanctioned subtractions of this requirement (context-mode bridge-internal variables, recorded plugin-projected names)

#### Scenario: Token not echoed to argv
- **WHEN** the server inspects the spawned process command-line via `ps` or equivalent
- **THEN** the spawn token SHALL NOT appear as an argv element

#### Scenario: Spawn without token (auto-resume disabled mode, future)
- **WHEN** `spawnPiSession` is called without a `spawnToken` argument (legacy callers)
- **THEN** the spawn SHALL proceed and `PI_DASHBOARD_SPAWN_TOKEN` SHALL NOT be set in the spawned process's env
- **AND** the bridge SHALL omit `spawnToken` from `session_register`, falling through to pid-link or cwd-FIFO at the server side

#### Scenario: Contaminated server spawns a working session
- **WHEN** the server process environment contains `CONTEXT_MODE_BRIDGE_DEPTH=1` and `CONTEXT_MODE_BRIDGE_IDLE_MS=0`
- **THEN** the spawned pi process environment SHALL contain neither variable, for every strategy

#### Scenario: Contaminated tmux server
- **WHEN** an already-running tmux server's global environment contains `CONTEXT_MODE_BRIDGE_DEPTH=1` and a session is spawned into it
- **THEN** the pi process in the new pane SHALL NOT have `CONTEXT_MODE_BRIDGE_DEPTH` set

#### Scenario: Unrelated context-mode variables survive
- **WHEN** the server process environment contains `CONTEXT_MODE_TZ=UTC`
- **THEN** the spawned pi process environment SHALL still contain `CONTEXT_MODE_TZ=UTC`
