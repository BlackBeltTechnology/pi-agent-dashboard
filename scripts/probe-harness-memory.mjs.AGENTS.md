# probe-harness-memory.mjs — index

Out-of-band harness memory probe (host side): `docker exec` reads cgroup v2 `memory.*` + `pids.current` and per-process `VmRSS` from `/proc` (image has no `ps`); container from `.pi-test-harness.json`; `--json`, `--label`. Exports `sample()` (also returns `residentPiPids`) and `compareResidentToSessions()` → `{orphaned, matched, unaccounted, orphanedCount, clean}`. Summed `VmRSS` overcounts vs the authoritative `memory.current`. See change: fix-e2e-harness-memory-exhaustion, fix-tmux-session-shutdown-leak.
