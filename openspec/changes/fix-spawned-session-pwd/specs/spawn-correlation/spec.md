## MODIFIED Requirements

### Requirement: `PI_DASHBOARD_SPAWN_TOKEN` env-var injection
The `spawnPiSession` function SHALL inject the minted `spawnToken` into the spawned process's environment as `PI_DASHBOARD_SPAWN_TOKEN`. The injection SHALL happen via the existing `buildSpawnEnv` flow so it applies to every spawn mechanism. The token SHALL NOT be passed via argv or via the session JSONL file.

#### Scenario: Token present in spawned process env
- **WHEN** `spawnPiSession(cwd, opts)` runs and produces a spawned process
- **THEN** `process.env.PI_DASHBOARD_SPAWN_TOKEN` in the spawned process SHALL equal the `spawnToken` minted for that invocation

#### Scenario: Existing env vars preserved
- **WHEN** the dashboard server has its own environment containing `PI_DASHBOARD_URL`, `PATH`, etc.
- **THEN** the spawned process SHALL receive those vars unchanged in addition to `PI_DASHBOARD_SPAWN_TOKEN`, except `PWD`, which names the spawn cwd (headless-spawn capability)

#### Scenario: Token is not echoed to argv
- **WHEN** the server inspects the spawned process command line
- **THEN** the `spawnToken` SHALL NOT appear as a CLI argument
