# process-manager.ts — index

Spawns/kills pi sessions. Exports `spawnPiSession`, `buildSpawnEnv`, `buildHeadlessArgs`, `buildTmuxCommand` (argv `string[]`, not shell string), `spawnTmux`, `spawnWslTmux`,… → see `process-manager.ts.AGENTS.md`. See change: fix-tmux-cwd-command-injection.

Spawn pin: `buildSpawnEnv` sets `PI_DASHBOARD_URL=ws://localhost:<spawnDashboardPiPort>` AND, when this instance serves a socket at that port, `PI_DASHBOARD_SOCKET=<gateway-<piPort>.sock>`; any inherited `PI_DASHBOARD_SOCKET` is deleted first (it outranks our URL in the bridge ladder, so it would re-create the cross-instance capture the pin prevents). See change: add-pi-gateway-transport-identity (task 2.0f).

Scope env: `SessionOptions` gains `extensionConfig?: Record<name, Record<key, value>>` (structural superset of shared `SessionFlags`; populated by `pluginSpawnToSessionOptions`). `buildSpawnEnv(baseEnv, { extensionConfig })` projects each `extensionConfig[name][key]` → `PI_EXT_<NAME>_<KEY>=value`; name+key uppercased, non-`[A-Z0-9_]`→`_`. Absent ⇒ env untouched (byte-identical). NUL-bearing value already dropped by the mapper. Only `spawnHeadless` passes `extensionConfig` (plugin spawns are headless-only); tmux/wt/wsl paths never project it. See change: add-plugin-spawn-scope.
