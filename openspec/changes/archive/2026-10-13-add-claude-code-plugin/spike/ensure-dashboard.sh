#!/bin/sh
# Idempotent: probe -> start detached if down -> wait -> print BASE=<url>. Exit 0 ready, 2 sandbox, 1 failure.
# Overrides: DASHBOARD_PORT, DASHBOARD_HOME (isolated instance), DASHBOARD_PI_PORT.
H="${DASHBOARD_HOME:-$HOME}"
if [ -n "${CLAUDE_CODE_IS_COWORK:-}${CLAUDE_CODE_REMOTE:-}" ]; then
  echo "SANDBOX: this session does not run on the user's computer; cannot start or reach pi-dashboard." >&2; exit 2
fi
PORT="${DASHBOARD_PORT:-}"
[ -z "$PORT" ] && PORT=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$H/.pi/dashboard/config.json" 2>/dev/null | grep -o '[0-9]*$' | head -n1)
[ -z "$PORT" ] && PORT=8000
case "$PORT" in ''|*[!0-9]*) echo "invalid port '$PORT'" >&2; exit 1;; esac
BASE="http://localhost:$PORT"
up() { curl -s -m 2 "$BASE/api/health" 2>/dev/null | grep -q '"ok"'; }
# Probe up to 3x5s. Start ONLY on "connection refused" (curl 7). A held-but-silent port (timeout)
# or a foreign HTTP service is never started over.
i=0; while [ $i -lt 3 ]; do
  body=$(curl -s -m 5 "$BASE/api/health" 2>/dev/null); rc=$?
  case $rc in
    0) if echo "$body" | grep -q '"ok"'; then echo "STATUS=already-running"; echo "BASE=$BASE"; exit 0; fi
       echo "PORT_CONFLICT: $BASE answers but is not pi-dashboard; set DASHBOARD_PORT" >&2; exit 1;;
    7) break;;
  esac; i=$((i+1))
done
if [ $rc -ne 7 ]; then echo "BUSY: something holds port $PORT but /api/health does not answer (likely an overloaded dashboard). Not starting a second one; check $H/.pi/dashboard/server.log" >&2; exit 3; fi
set -- start --port "$PORT"
[ -n "${DASHBOARD_PI_PORT:-}" ] && set -- "$@" --pi-port "$DASHBOARD_PI_PORT"
if command -v pi-dashboard >/dev/null 2>&1; then HOME="$H" pi-dashboard "$@" >&2
else HOME="$H" npx -y @blackbelt-technology/pi-agent-dashboard "$@" >&2; fi || { echo "start failed" >&2; exit 1; }
i=0; while [ $i -lt 30 ]; do up && { echo "STATUS=started"; echo "BASE=$BASE"; exit 0; }; i=$((i+1)); sleep 2; done
echo "not healthy after 60s; see $H/.pi/dashboard/server.log" >&2; exit 1
