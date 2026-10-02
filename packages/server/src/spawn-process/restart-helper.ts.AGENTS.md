# restart-helper.ts — index

Cross-platform restart orchestrator for POST /api/restart. Exports `RestartParams`, `buildOrchestratorScript(params)`, `spawnRestart(params)`. Spawns detached `node -e` script that kills prior daemon, polls port free, spawns new server preserving bound port, polls /api/health (15s prod / 60s dev).

Adds `buildRestartEnv(baseEnv, maxOldSpaceMb)` — pure copy of env, re-stamped via shared `stampHeapFlag` (own marker-matched token replaced, operator pin untouched, nothing added). `spawnRestart` passes `buildRestartEnv(process.env, loadConfig().serverHeap.maxOldSpaceMb)` to the orchestrator, which hands it to the new server: ceiling RE-READ at restart time, so `/api/restart` applies a `serverHeap` edit. See change: guard-server-heap-and-store-coupling (D5).
