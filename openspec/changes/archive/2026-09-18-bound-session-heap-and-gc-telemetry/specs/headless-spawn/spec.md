## MODIFIED Requirements

### Requirement: `PI_DASHBOARD_SPAWN_TOKEN` env-var injected on every spawn
For every invocation of `spawnPiSession()` — regardless of strategy (`tmux`, `wt`, `wsl-tmux`, `headless`) and regardless of platform — the server SHALL inject `PI_DASHBOARD_SPAWN_TOKEN` (a freshly-minted UUIDv4) into the spawned process's environment via `buildSpawnEnv`. The injection SHALL be the only mechanism by which the spawn token reaches the spawned pi process; the token SHALL NOT be passed via argv, the session JSONL file, or any other channel.

The `buildSpawnEnv(baseEnv, opts?)` function SHALL accept an optional `spawnToken: string` argument and SHALL set `result.PI_DASHBOARD_SPAWN_TOKEN = spawnToken` when provided. The existing `prependManagedNodeToPath` and other env-shaping behaviors SHALL be preserved unchanged, with one exception: a heap-sizing flag the dashboard stamped into its own environment SHALL be removed from the child environment, per the heap-limits capability. That removal is the only sanctioned subtraction; no other inherited variable SHALL be dropped, and a heap flag the operator pinned themselves SHALL be preserved.

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
- **AND** every other inherited variable SHALL still be passed through unchanged

#### Scenario: Token not echoed to argv
- **WHEN** the server inspects the spawned process command-line via `ps` or equivalent
- **THEN** the spawn token SHALL NOT appear as an argv element

#### Scenario: Spawn without token (auto-resume disabled mode, future)
- **WHEN** `spawnPiSession` is called without a `spawnToken` argument (legacy callers)
- **THEN** the spawn SHALL proceed and `PI_DASHBOARD_SPAWN_TOKEN` SHALL NOT be set in the spawned process's env
- **AND** the bridge SHALL omit `spawnToken` from `session_register`, falling through to pid-link or cwd-FIFO at the server side

## ADDED Requirements

### Requirement: The invocation handed to the keeper carries the heap arguments

The keeper spawns pi from the invocation it is given at launch. The heap
arguments SHALL be present in that invocation, so the pi process the keeper
starts runs under the configured ceiling.

The keeper SHALL NOT be constrained by the session ceiling. It supervises pi
rather than running agent work, and the limit is carried as a pi process
argument for exactly that reason. The ceiling SHALL NOT be applied to this
strategy through the keeper's environment, which the keeper passes on to pi and
which would therefore bind both processes.

#### Scenario: Keeper-spawned pi runs under the ceiling
- **WHEN** a session is spawned on the headless strategy with a configured ceiling
- **THEN** the pi process the keeper starts SHALL run under that ceiling

#### Scenario: Keeper process itself is not capped
- **WHEN** the session heap ceiling is configured
- **THEN** the keeper process SHALL NOT be constrained by it

#### Scenario: A reload adopts current configuration
- **WHEN** the ceiling is changed and a headless session is reloaded
- **THEN** the reload SHALL produce a pi process running under the new ceiling
- **AND** no stale invocation SHALL be reused
