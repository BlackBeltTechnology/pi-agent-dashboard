#!/usr/bin/env bash
# Test: /api/pi-resources latency budget + skill-discovery regression probes.
#
# P1  — resources refresh across N known directories stays within the p95
#       budget; `resolve()` is bounded by RESOLVE_TIMEOUT_MS so no directory
#       can hang the payload.
# X10 — a skill's companion files (`references/*.md`) remain READABLE after
#       discovery moved to pi's resolver.
# X11 — a bundled slash command under `pi-dashboard/commands/` is still
#       REACHABLE at its resolved path.
#
# Scope limit, stated plainly: both are reachability probes over
# `/api/pi-resource-file`, not execution proofs. They catch the regression this
# change could plausibly cause — a path the resolver reports that the server
# then refuses to serve — but they do not invoke a live session. Proving that a
# skill loads its companion at runtime belongs to a live-session test, not to
# this VM smoke layer.
#
# See change: fix-skill-discovery-parity (test-plan P1, X10, X11).
set -euo pipefail

echo "=== Test: pi-resources parity ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

PORT="${DASHBOARD_PORT:-8000}"
BASE="http://localhost:${PORT}"
# C1 caps resolve() at 5s. The p95 budget is deliberately TIGHTER so this
# assertion catches a slow-but-not-timed-out regression; a request that actually
# hits the timeout is caught separately by the degraded check below.
BUDGET_MS="${PI_RESOURCES_P95_BUDGET_MS:-2000}"
SAMPLES="${PI_RESOURCES_SAMPLES:-10}"

pi-dashboard start &
SERVER_PID=$!
cleanup() {
  pi-dashboard stop 2>/dev/null || true
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for the server.
ELAPSED=0
while [ $ELAPSED -lt 20 ]; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" 2>/dev/null || echo 000)" = "200" ] && break
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done
if [ $ELAPSED -ge 20 ]; then
  echo "FAIL: server did not come up on $BASE"
  exit 1
fi

CWD="$(pwd)"

# Query helpers. Filesystem-derived values are URL-encoded: a path containing
# a space, `#`, `&` or `?` would otherwise truncate or rewrite the query and
# silently measure a different resource.
resources_get() { # $1 = extra flag ("" or "refresh=true"); writes body to $2
  curl -sS --get --data-urlencode "cwd=$CWD" ${1:+--data-urlencode "$1"} \
    -o "$2" -w '%{http_code} %{time_total}' "$BASE/api/pi-resources"
}
resource_file_code() { # $1 = absolute path
  curl -sS --get --data-urlencode "path=$1" -o /dev/null -w '%{http_code}' "$BASE/api/pi-resource-file"
}

# Warm the cache so the measurement is the warm path, not first-scan.
resources_get "refresh=true" /dev/null > /dev/null

# ── P1: p95 across SAMPLES refreshes ────────────────────────────────
echo "--- P1: latency across $SAMPLES refreshes (budget ${BUDGET_MS}ms p95)"
TIMES_FILE=$(mktemp)
for _ in $(seq 1 "$SAMPLES"); do
  # Read the status alongside the timing: a fast 500 or 404 must not be
  # allowed to satisfy the p95 assertion.
  read -r CODE SECS <<< "$(resources_get "refresh=true" /dev/null)"
  if [ "$CODE" != "200" ]; then
    echo "FAIL: /api/pi-resources returned HTTP $CODE"
    rm -f "$TIMES_FILE"
    exit 1
  fi
  echo "$SECS" | awk '{ printf "%d\n", $1 * 1000 }' >> "$TIMES_FILE"
done
P95=$(sort -n "$TIMES_FILE" | awk -v n="$SAMPLES" 'NR == int((n * 95 + 99) / 100) { print; exit }')
rm -f "$TIMES_FILE"
echo "p95 = ${P95}ms"
if [ "$P95" -gt "$BUDGET_MS" ]; then
  echo "FAIL: p95 ${P95}ms exceeds the ${BUDGET_MS}ms budget"
  exit 1
fi

# The payload must not be degraded — a degraded payload would mean resolve()
# threw or timed out, which invalidates the latency claim above.
BODY_FILE=$(mktemp)
read -r CODE _ <<< "$(resources_get "" "$BODY_FILE")"
if [ "$CODE" != "200" ]; then
  echo "FAIL: /api/pi-resources returned HTTP $CODE"
  exit 1
fi
if grep -q '"degraded":true' "$BODY_FILE"; then
  echo "FAIL: payload is degraded — resolve() failed or exceeded its timeout"
  exit 1
fi
rm -f "$BODY_FILE"
echo "PASS: P1"

# ── X10: a skill's companion files stay readable ────────────────────
echo "--- X10: skill companion files"
SKILL_WITH_REFS=$(find . -type d -name references -path '*skills*' -not -path './node_modules/*' | head -1)
if [ -n "$SKILL_WITH_REFS" ]; then
  COMPANION=$(find "$SKILL_WITH_REFS" -name '*.md' | head -1)
  RESP=$(resource_file_code "$(cd "$(dirname "$COMPANION")" && pwd)/$(basename "$COMPANION")")
  if [ "$RESP" != "200" ]; then
    echo "FAIL: companion file $COMPANION not readable (HTTP $RESP)"
    exit 1
  fi
  echo "PASS: X10 ($COMPANION)"
else
  echo "SKIP: X10 — no skill with a references/ subtree in this workspace"
fi

# ── X11: a bundled slash command still resolves ─────────────────────
echo "--- X11: bundled slash command"
BUNDLED=$(find . -type d -path '*pi-dashboard/commands' -not -path './node_modules/*' | head -1)
if [ -n "$BUNDLED" ]; then
  CMD=$(find "$BUNDLED" -name '*.md' | head -1)
  if [ -z "$CMD" ]; then
    echo "SKIP: X11 — no command file under $BUNDLED"
  else
    RESP=$(resource_file_code "$(cd "$(dirname "$CMD")" && pwd)/$(basename "$CMD")")
    if [ "$RESP" != "200" ]; then
      echo "FAIL: bundled command $CMD does not resolve (HTTP $RESP)"
      exit 1
    fi
    echo "PASS: X11 ($CMD)"
  fi
else
  echo "SKIP: X11 — no pi-dashboard/commands directory in this workspace"
fi

echo "PASS: pi-resources parity"
exit 0
