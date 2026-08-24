# process-manager.ts — index

Spawns/kills pi sessions. Exports `spawnPiSession`, `buildSpawnEnv`, `buildHeadlessArgs`, `buildTmuxCommand` (argv `string[]`, not shell string), `spawnTmux`, `spawnWslTmux`,… → see `process-manager.ts.AGENTS.md`. See change: fix-tmux-cwd-command-injection.

Spawn pin: `buildSpawnEnv` sets `PI_DASHBOARD_URL=ws://localhost:<spawnDashboardPiPort>` AND, when this instance serves a socket at that port, `PI_DASHBOARD_SOCKET=<gateway-<piPort>.sock>`; any inherited `PI_DASHBOARD_SOCKET` is deleted first (it outranks our URL in the bridge ladder, so it would re-create the cross-instance capture the pin prevents). See change: add-pi-gateway-transport-identity (task 2.0f).
