# 02-server-start.sh — index

Unix server-start smoke. `pi-dashboard start &`, poll `/api/health` for HTTP 200 (15s). Verifies `~/.pi/dashboard/server.log` exists + non-empty (catches v0.4.6 `spawnDetached stdio[1]='ignore'` 0-byte regression). trap cleanup stops server.
