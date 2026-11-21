#!/usr/bin/env bash
# Test: `service exec` forwards SIGTERM to its child and releases the lease
# (test-plan #S34). See change: harden-path-and-process-guards (#1103).
#
# A SIGTERM-ignoring child must be gone ~5 s (the kill-grace) after `kill -TERM
# <exec pid>`, the lease released (service status shows no holder) and the exec
# exit status 137. Linux + macOS; SKIPs (exit 0) elsewhere. (Numbered 58: slot 50
# was taken by the dist-only plugin test.)
#
# Hermetic: throwaway $HOME + QA_PORT (default 18343), never :8000. The service is
# an `external` entry pointing at the dashboard's own /api/health, so no image or
# package is fetched. Launcher: PI_DASHBOARD_CMD (default `pi-dashboard`; checkout:
# `node packages/server/bin/pi-dashboard.mjs`).
set -euo pipefail

echo "=== Test: service exec signal forwarding (#S34) ==="

case "$(uname -s)" in
  Linux | Darwin) ;;
  *) echo "SKIP: POSIX signals only (win32 is manual-only, see X18)"; exit 0 ;;
esac

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

QA_PORT="${QA_PORT:-18343}"
read -r -a DASH <<<"${PI_DASHBOARD_CMD:-pi-dashboard}"
REAL_HOME="$HOME"
QA_HOME="$(mktemp -d)"
CHILD_PID_FILE="$QA_HOME/child.pid"
EXEC_PID=""

svc() { HOME="$QA_HOME" "${DASH[@]}" service "$@" --port "$QA_PORT"; }
stop_server() { HOME="$QA_HOME" "${DASH[@]}" stop --port "$QA_PORT" >/dev/null 2>&1 || true; sleep 1; }
cleanup() {
  [ -n "$EXEC_PID" ] && kill -KILL "$EXEC_PID" 2>/dev/null || true
  [ -f "$CHILD_PID_FILE" ] && kill -KILL "$(cat "$CHILD_PID_FILE")" 2>/dev/null || true
  svc remove --all --json >/dev/null 2>&1 || true
  stop_server
  HOME="$REAL_HOME"
  rm -rf "$QA_HOME"
}
trap cleanup EXIT

mkdir -p "$QA_HOME/.pi/dashboard"
HOME="$QA_HOME" NVM_DIR="$NVM_DIR" "${DASH[@]}" start --port "$QA_PORT" >/dev/null 2>&1 &
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$QA_PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$QA_PORT/api/health" >/dev/null 2>&1 || { echo "FAIL: dashboard did not come up on :$QA_PORT"; exit 1; }

cat >"$QA_HOME/sig.json" <<JSON
{
  "id": "sigsvc",
  "mode": "external",
  "endpoints": { "http": "http://127.0.0.1:$QA_PORT" },
  "health": { "kind": "http", "endpoint": "http", "path": "/api/health" }
}
JSON
svc add --file "$QA_HOME/sig.json" --yes --json >/dev/null

# The child records its pid, then ignores SIGTERM.
CHILD_JS="require('fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
set +e
HOME="$QA_HOME" "${DASH[@]}" service exec sigsvc --port "$QA_PORT" -- node -e "$CHILD_JS" "$CHILD_PID_FILE" &
EXEC_PID=$!
set -e
for _ in $(seq 1 20); do [ -s "$CHILD_PID_FILE" ] && break; sleep 0.5; done
[ -s "$CHILD_PID_FILE" ] || { echo "FAIL: exec child never started"; exit 1; }
CHILD_PID="$(cat "$CHILD_PID_FILE")"
kill -0 "$CHILD_PID" || { echo "FAIL: child $CHILD_PID not running"; exit 1; }

kill -TERM "$EXEC_PID"
sleep 6
if kill -0 "$CHILD_PID" 2>/dev/null; then
  echo "FAIL (#S34): child $CHILD_PID survived exec's SIGTERM + 5 s grace"
  exit 1
fi
set +e
wait "$EXEC_PID"
STATUS=$?
set -e
EXEC_PID=""
if [ "$STATUS" -ne 137 ]; then echo "FAIL (#S34): exec exit status $STATUS (want 137)"; exit 1; fi

STATUSJSON="$(svc status sigsvc --json)"
if printf '%s' "$STATUSJSON" | grep -Eq '"holders?"[[:space:]]*:[[:space:]]*(\[[^]]+\]|[1-9])'; then
  echo "FAIL (#S34): lease still held after exec exit: $STATUSJSON"
  exit 1
fi

echo "#S34: child gone after the grace, exec exit 137, lease released"
echo "PASS"
