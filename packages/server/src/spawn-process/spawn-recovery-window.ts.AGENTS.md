# spawn-recovery-window.ts — index

Single source of `RECOVERY_GRACE_MS`/`ORDERING_MARGIN_MS` + `deriveSpawnCorrelationTtlMs`; every spawn TTL derives from the timeout that armed that spawn. → see `spawn-recovery-window.ts.AGENTS.md`. See change: fix-spawn-correlation-ttl-coupling.
