# prune-memory-backups.mjs — index

Recurring maintenance: trims `~/.pi/agent/pi-hermes-memory/`. Deletes all `sessions.db.corrupt-*` (incl. `-shm`/`-wal` sidecars) and all but the `--keep N` newest `sessions.db.bak.auto-<YYYYMMDD>-<HHMMSS>` (default 2). Dry-run unless `--write`; `--dir` overrides the store. Idempotent. Exports `planPrune(names, keep)` (pure), `prune({dir,keep,write})`, `DEFAULT_KEEP`, `DEFAULT_DIR`. npm: `clean:memory` / `clean:memory:write`. Store grows ~700MB/backup and self-prunes nothing — reached 5.7GB/78 corrupt files and filled a disk.
