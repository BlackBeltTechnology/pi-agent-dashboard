#!/usr/bin/env bash
# Test: /api/pi-resources latency budget + skill-discovery regression probes.
#
# P1  — resources refresh across N known directories stays within the p95
#       budget; `resolve()` is bounded by RESOLVE_TIMEOUT_MS so no directory
#       can hang the payload.
# X10 — a skill's companion files (`references/*.md`) remain readable after
#       discovery moved to pi's resolver.
# X11 — a bundled slash command under `pi-dashboard/commands/` still resolves.
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

# Warm the cache so the measurement is the warm path, not first-scan.
curl -s -o /dev/null "$BASE/api/pi-resources?cwd=$CWD&refresh=true"

# ── P1: p95 across SAMPLES refreshes ────────────────────────────────
echo "--- P1: latency across $SAMPLES refreshes (budget ${BUDGET_MS}ms p95)"
TIMES_FILE=$(mktemp)
for _ in $(seq 1 "$SAMPLES"); do
  MS=$(curl -s -o /dev/null -w '%{time_total}' "$BASE/api/pi-resources?cwd=$CWD&refresh=true" \
    | awk '{ printf "%d", $1 * 1000 }')
  echo "$MS" >> "$TIMES_FILE"
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
BODY=$(curl -s "$BASE/api/pi-resources?cwd=$CWD")
if echo "$BODY" | grep -q '"degraded":true'; then
  echo "FAIL: payload is degraded — resolve() failed or exceeded its timeout"
  exit 1
fi
echo "PASS: P1"

# ── X10: a skill's companion files stay readable ────────────────────
echo "--- X10: skill companion files"
SKILL_WITH_REFS=$(find . -type d -name references -path '*skills*' -not -path './node_modules/*' | head -1)
if [ -n "$SKILL_WITH_REFS" ]; then
  COMPANION=$(find "$SKILL_WITH_REFS" -name '*.md' | head -1)
  RESP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/pi-resource-file?path=$(cd "$(dirname "$COMPANION")" && pwd)/$(basename "$COMPANION")")
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
    RESP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/pi-resource-file?path=$(cd "$(dirname "$CMD")" && pwd)/$(basename "$CMD")")
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
