# DOX — packages/server/src/spawn-process

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `headless-pid-registry.ts` | Registry mapping headless child processes → session IDs. Exports `createHeadlessPidRegistry`,… → see `headless-pid-registry.ts.AGENTS.md` |
| `idle-timer.ts` | Auto-shutdown timer with sleep-wake resilience. Exports `IdleTimer`, `HasActiveTerminals`,… → see `idle-timer.ts.AGENTS.md` |
| `process-classifier.ts` | Pure process classifier. Enriches scanned `process_list` entries with `kind`, `label`, `sessionRef` by… → see `process-classifier.ts.AGENTS.md` |
| `process-manager.ts` | Spawns/kills pi sessions. Exports `spawnPiSession`, `buildSpawnEnv`, `buildHeadlessArgs`, `buildTmuxCommand` (argv `string[]`, not shell string), `spawnTmux`, `spawnWslTmux`,… → see `process-manager.ts.AGENTS.md`. See change: fix-tmux-cwd-command-injection. |
| `restart-helper.ts` | Cross-platform restart orchestrator for POST /api/restart. → see `restart-helper.ts.AGENTS.md` |
| `server-pid.ts` | PID file management at `~/.pi/dashboard/server.pid`. Exports `writePid`, `readPid`, `removePid`,… → see `server-pid.ts.AGENTS.md` |
| `spawn-failure-log.ts` | Appends/reads rolling NDJSON log of failed spawns (`~/.pi/dashboard/sessions/spawn-failures.log`). Single-shot rotation at 10 MB. See change: spawn-failure-diagnostics. |
| `spawn-preflight.ts` | Pure sync preflight: checks cwd exists/is-dir/writable + pi+node resolvable. → see `spawn-preflight.ts.AGENTS.md` |
| `spawn-register-watchdog.ts` | Arms per-spawn timer; fires `spawn_register_timeout` if pi never registers. byPid + byCwd + byToken maps. recentlyFired (60s TTL) emits `spawn_register_recovered`. Firing also RECLAIMS the spawn — `findPidsBySpawnToken` → kill ladder — because a pi that never registers has no session record and is unreachable by shutdown/reap/idle-reclaim (measured: tmux panes stuck on pi's trust prompt, ~127 MB each). Never kills `process.pid`/`ppid`; kill runs BEFORE the `ws.readyState` early return; a cwd entry with its own token is not disarmed by a sibling spawn. Inject `WatchdogReclaimDeps` in tests. See change: spawn-failure-diagnostics, fix-tmux-session-shutdown-leak (D7). |
| `spawned-turn-log.ts` | Build redacted `server.log` lines for spawned-session turn outcomes. → see `spawned-turn-log.ts.AGENTS.md` |
