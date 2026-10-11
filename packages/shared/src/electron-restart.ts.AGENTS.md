# electron-restart.ts — index

`ELECTRON_RESTART_EXIT_CODE` (75) + `restartsViaElectron(env)` (Electron starter + `PI_DASHBOARD_ELECTRON_INSTANCE`). `/api/restart` on Electron-owned server exits 75; app restarts it via own runtime path (keeps starter, runtime identity, watchdog). See change: electron-runtime-overlay-updates.
