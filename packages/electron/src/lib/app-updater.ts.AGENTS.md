# app-updater.ts — index

electron-updater wrapper. `initAutoUpdater()` 60s + 24h check, dev-skip. `autoDownload=false`. `classifyUpdateError()` severity debug/warn/error. `logUpdate()` → `app.getPath('logs')/electron-main.log`. `checkForUpdatesNow()` → ManualCheckResult. `getUpdateLogPath()`. `downloadAndInstall()`/`quitAndInstall()`. `__setTestAutoUpdater()` test seam. See change: fix-electron-auto-update-pipeline.
