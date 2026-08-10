# electron-bootstrap-flow.md — index

Electron startup state machine. `app.whenReady()` → dashboard window. 5 states, 3 triggers, 3 end states (attach/done/loading-page-error). Health-probe `GET /api/health` port 8000. Electron launcher only.
