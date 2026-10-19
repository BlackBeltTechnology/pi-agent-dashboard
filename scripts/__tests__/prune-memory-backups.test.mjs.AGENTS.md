# __tests__/prune-memory-backups.test.mjs — index

Pins `planPrune` selection + `prune` IO for the hermes store trim. Weight is on the negative cases: live `sessions.db`/`-wal`/`-shm` and hand-made `.bak.cleanup-*`/`.bak.trim-*` are never candidates even at `keep: 0`. Also asserts dry-run deletes nothing, `--write` removes corrupt + surplus only, and a second run is a no-op.
