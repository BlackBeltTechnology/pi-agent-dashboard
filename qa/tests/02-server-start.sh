#!/usr/bin/env bash
# Test: pi-dashboard server starts and health endpoint responds
set -euo pipefail

echo "=== Test: Server start ==="

# Source nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Start the server in background
pi-dashboard start &
SERVER_PID=$!

# Cleanup on exit
cleanup() {
  pi-dashboard stop 2>/dev/null || true
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for health endpoint (up to 15 seconds)
ELAPSED=0
TIMEOUT=15
while [ $ELAPSED -lt $TIMEOUT ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "Health endpoint responded HTTP 200"

    # See change: expand-electron-qa-coverage.
    # Catches v0.4.6 spawnDetached stdio[1]='ignore' regression where
    # successful spawns produced 0-byte log files. Server log lives at
    # ~/.pi/dashboard/server.log (written by cli.ts daemonize path).
    LOG_PATH="$HOME/.pi/dashboard/server.log"
    if [ ! -f "$LOG_PATH" ]; then
      echo "FAIL: $LOG_PATH does not exist after successful spawn"
      exit 1
    fi
    if [ ! -s "$LOG_PATH" ]; then
      echo "FAIL: $LOG_PATH is 0 bytes after successful spawn (stdio regression?)"
      exit 1
    fi
    echo "Server log non-empty ($LOG_PATH, $(wc -c < "$LOG_PATH") bytes)"

    # See change: update-pi-core-0-84-adopt-apis (test-plan #X10, #X11).
    # The pi 0.84.1 bump touches provider-register.ts (model-registry refresh)
    # and the auto-session-namer (null-bearing provider headers). Both are
    # exercised through MOCKED catalog probes at L1, so a pi-ai symbol break
    # would pass every unit test and only surface on a real boot. Assert the
    # real server log carries no such runtime failure.
    if grep -qiE "is not a function|is not defined|Cannot find module|SyntaxError" "$LOG_PATH"; then
      echo "FAIL: server.log carries an unresolved-symbol/module error after the pi bump:"
      grep -inE "is not a function|is not defined|Cannot find module|SyntaxError" "$LOG_PATH" | head -5
      exit 1
    fi
    echo "No unresolved-symbol errors in server.log"

    # The running pi must satisfy the declared compatibility floor, and the
    # health probe must not report a blocking skew error.
    #
    # `curl -fsS` (not `-s`): a transport failure or non-2xx must FAIL the test
    # rather than feed an empty body to the parser, which would print nothing
    # and be misread as "no compatibility error".
    if ! HEALTH_JSON=$(curl -fsS http://localhost:8000/api/health 2>/dev/null); then
      echo "FAIL: could not fetch /api/health for the compatibility check"
      exit 1
    fi
    # The parser exits non-zero on unparseable JSON, so a malformed body fails
    # loudly instead of silently reporting success.
    if ! COMPAT_ERROR=$(printf '%s' "$HEALTH_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}const c=j.compatibility;process.stdout.write(c&&c.error?c.error:'')})"); then
      echo "FAIL: /api/health returned a body that is not valid JSON"
      exit 1
    fi
    if [ -n "$COMPAT_ERROR" ]; then
      echo "FAIL: /api/health reports a blocking pi compatibility error: $COMPAT_ERROR"
      exit 1
    fi
    echo "No blocking pi compatibility error"

    echo "PASS: Server started successfully"
    exit 0
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

echo "FAIL: Health endpoint did not respond HTTP 200 within ${TIMEOUT}s (got: $HTTP_CODE)"
exit 1
