# pending-fork-registry.ts — index

Tracks pending fork operations keyed by `spawnToken` to place forked sessions after parent. Exports `PendingForkRegistry`, `createPendingForkRegistry`. `recordFork`/`consumeFork`/`dispose`; 30s expiry. Replaces prior cwd-FIFO keying that raced on multi-fork-in-same-cwd.
