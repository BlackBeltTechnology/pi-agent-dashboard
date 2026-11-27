# runtime-resolution.ts — index

Process-lifetime holder for the ladder-resolved pi spawn runtime. Exports `setCurrentSpawnRuntime`, `currentSpawnRuntime` (null before startup resolution — Doctor rows suppress), `resolveLiveSpawnRuntime(opts)` (ladder re-run + holder update; used at startup and on spawn-time re-validation failure). Consumed by process-manager spawn surfaces, doctor-routes, rebuild executor. See change: unify-pi-runtime-identity (design D1/D3).
