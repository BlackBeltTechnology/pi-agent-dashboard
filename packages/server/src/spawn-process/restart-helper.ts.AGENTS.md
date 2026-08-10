# restart-helper.ts — index

Cross-platform restart orchestrator for POST /api/restart. Exports `RestartParams`, `buildOrchestratorScript(params)`, `spawnRestart(params)`. Spawns detached `node -e` script that kills prior daemon, polls port free, spawns new server preserving bound port, polls /api/health (15s prod / 60s dev).
