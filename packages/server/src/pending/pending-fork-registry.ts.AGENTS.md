# pending-fork-registry.ts — index

Tracks pending fork operations keyed by `spawnToken` to place forked sessions after parent. Exports `PendingForkRegistry`, `createPendingForkRegistry`. `recordFork(token, parentSessionId, ttlMs)`/`consumeFork`/`dispose`. Per-entry TTL from `deriveSpawnCorrelationTtlMs`, replacing `EXPIRY_MS = 30_000` — 30s had zero slack even at the DEFAULT timeout, so a slow fork lost its parent placement. Replaces prior cwd-FIFO keying that raced on multi-fork-in-same-cwd. See change: fix-spawn-correlation-ttl-coupling.
