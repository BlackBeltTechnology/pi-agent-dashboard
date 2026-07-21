# spawn-token.ts — index

Spawn correlation token. Exports `mintSpawnToken()` (UUIDv4), `SPAWN_TOKEN_ENV_VAR = "PI_DASHBOARD_SPAWN_TOKEN"`. In-memory only; injected into spawned process env, echoed by bridge in `session_register.spawnToken`.
