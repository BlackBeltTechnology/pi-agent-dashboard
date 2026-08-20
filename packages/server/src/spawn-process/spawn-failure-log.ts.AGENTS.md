# spawn-failure-log.ts — index

Appends/reads rolling NDJSON log of failed spawns (`~/.pi/dashboard/sessions/spawn-failures.log`). Single-shot rotation at 10 MB. `SpawnFailureEntry.spawnToken` joins a `REGISTER_TIMEOUT` fire to its `REGISTER_RECOVERED` companion. See change: spawn-failure-diagnostics, fix-spawn-correlation-ttl-coupling.
