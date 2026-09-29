# electron-bootstrap-flow.md — index

Electron startup state machine. `app.whenReady()` → dashboard window. 5 states, 3 triggers, 3 end states (attach/done/loading-page-error). Health-probe `GET /api/health` port 8000. Electron launcher only.

Gains runtime overlay: launch precedence attach → devMonorepo → localLink → overlay → bundled; readiness deadlines 60 s devMonorepo/localLink, 15 s overlay/bundled; cold-launch retry-once + bad marking; `switchRuntime` PID-scoped switch (health-PID probe, 60 s old-exit deadline, commit/rollback/environmental abort); 2 s activation nonce watcher; D8 convergent bridge reload (`PI_DASHBOARD_EXTENSION_DIR`, one `/reload` per session per runtime id). See change: electron-runtime-overlay-updates.
