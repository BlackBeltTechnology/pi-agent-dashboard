# 02-server-start.sh — index

Unix server-start smoke. `pi-dashboard start &`, poll `/api/health` for HTTP 200 (15s). Verifies `~/.pi/dashboard/server.log` exists + non-empty (catches v0.4.6 `spawnDetached stdio[1]='ignore'` 0-byte regression). trap cleanup stops server. Start twice + `status` (#X19): first `start` verdict is captured (`START1_OUT`) and must be `started (pid N)` on a cold boot; a second `start` must print `already running (pid N)` with the same N (never `started`); `status` must print `running (pid N)` exit 0. See change: harden-dashboard-start-detection.

WX3: counters (`cspReports` counts, `dropped`, `since`) survive `POST /api/restart`. See change: harden-cors-and-csp-reporting.

AE12: config with an OAuth provider and no `auth.secret`; first start mints `^[0-9a-f]{64}$` into `config.json`, second start keeps it byte-identical, `server.log` never contains the value. Unverified locally (VM-only L2). See change: harden-auth-credentials.
