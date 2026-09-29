# server-launcher.ts — index

`launchDashboardServer` — single shared spawn primitive (jiti loader, argv, env, log header, readiness) used by Bridge / Standalone / Electron starters. Also exports `RECOVERY_PORT_CONFLICT_EXIT_CODE` + `isPortConflictExitCode` (child exit 2 → `PortConflictError`). See change: fix-worktree-server-autostart-leak. `opts.env` overlay PATH key normalized before merge (caller `Path` replaces base `PATH`). See change: fix-windows-path-env-key-casing. `LaunchOpts.onSpawned(pid)` fires right after spawn, before readiness. See change: electron-runtime-overlay-updates.
