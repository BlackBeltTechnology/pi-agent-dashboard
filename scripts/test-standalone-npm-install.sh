#!/usr/bin/env bash
# scripts/test-standalone-npm-install.sh
#
# End-to-end smoke for the standalone npm install path:
#   1. npm pack every publishable workspace
#   2. install them into an isolated temp HOME with no pi installed
#   3. spawn pi-dashboard headless
#   4. poll /api/health until ok=true (or fail after 60s)
#   5. assert the web UI is reachable
#   6. tear down
#
# Probe rationale: after eliminate-electron-runtime-install (commit
# d3fe2163) the dashboard no longer installs pi lazily after server
# start — there is no "bootstrap" reconcile phase to wait for. The
# server is either listening on its port or it isn't, so a plain
# /api/health probe is the right readiness signal. 60s gives ample
# headroom for cold node startup on slow CI runners without making
# genuine failures hang the job.
#
# Usage:
#   ./scripts/test-standalone-npm-install.sh [--keep] [--port 18000]
#
# --keep: leave the temp HOME on disk for inspection
# --port: dashboard port (default 18000 to avoid colliding with a dev instance)

set -euo pipefail

KEEP=0
PORT=18000
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TMP=$(mktemp -d -t pi-dash-standalone-XXXXXX)
TMP_HOME="$TMP/home"
PACK_DIR="$TMP/packs"
mkdir -p "$TMP_HOME" "$PACK_DIR"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ "$KEEP" -eq 1 ]]; then
    echo "[smoke] kept temp HOME at: $TMP_HOME"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

echo "[smoke] temp HOME: $TMP_HOME"
echo "[smoke] packing workspaces..."

# Build the web client first (its dist/ is shipped in the published tarball).
( cd packages/client && npm run build >/dev/null )

# Pack root + every workspace under packages/. `npm pack -ws --include-workspace-root`
# emits one .tgz per package into the cwd.
(
  cd "$PACK_DIR"
  npm --prefix "$REPO_ROOT" pack -ws --include-workspace-root --pack-destination "$PACK_DIR" >/dev/null
)
TGZS=("$PACK_DIR"/*.tgz)
echo "[smoke] packed ${#TGZS[@]} tarballs"

# Install into an isolated prefix under TMP_HOME. We use a project-local install
# (npm i <tgz> ...) into a fresh package dir so the resolution chain mirrors what
# `npm i -g <root-tgz>` would do (each workspace is published independently to npm).
INSTALL_DIR="$TMP_HOME/pi-dashboard-install"
mkdir -p "$INSTALL_DIR"
( cd "$INSTALL_DIR" && npm init -y >/dev/null )

echo "[smoke] installing tarballs into ${INSTALL_DIR}..."
( cd "$INSTALL_DIR" && npm install "${TGZS[@]}" --no-audit --no-fund 2>&1 | tail -3 )

BIN="$INSTALL_DIR/node_modules/.bin/pi-dashboard"
if [[ ! -x "$BIN" ]]; then
  echo "[smoke] FAIL: pi-dashboard bin not found at $BIN" >&2
  exit 1
fi

echo "[smoke] launching pi-dashboard on port ${PORT}..."
HOME="$TMP_HOME" \
  PI_DASHBOARD_PORT="$PORT" \
  "$BIN" > "$TMP/server.log" 2>&1 &
SERVER_PID=$!
echo "[smoke] server pid: $SERVER_PID"

# Poll /api/health for up to 60s. See header rationale.
DEADLINE=$((SECONDS + 60))
READY=0
while [[ $SECONDS -lt $DEADLINE ]]; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[smoke] FAIL: server exited early; log:" >&2
    cat "$TMP/server.log" >&2
    exit 1
  fi
  # /api/health returns { ok: true, mode, uptime, ... } once the
  # server is listening. We only need a single 200-with-ok=true.
  if RESP=$(curl -fsS "http://localhost:$PORT/api/health" 2>/dev/null); then
    OK=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).ok===true?'true':'false')}catch{console.log('parse-error')}})")
    if [[ "$OK" == "true" ]]; then
      MODE=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).mode||'unknown')}catch{console.log('?')}})")
      UPTIME=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).uptime||0)}catch{console.log('?')}})")
      echo "[smoke] ✓ server healthy (mode=$MODE, uptime=${UPTIME}s)"
      READY=1
      break
    fi
  fi
  sleep 2
done

if [[ "$READY" -ne 1 ]]; then
  echo "[smoke] FAIL: /api/health did not return ok=true within 60s" >&2
  tail -50 "$TMP/server.log" >&2
  exit 1
fi

# Confirm UI is served.
if curl -fsS "http://localhost:$PORT/" > /dev/null; then
  echo "[smoke] ✓ web UI reachable"
else
  echo "[smoke] FAIL: web UI not reachable" >&2
  exit 1
fi

echo "[smoke] ✓ standalone npm install smoke passed"
