#!/usr/bin/env bash
# Test: the cross-site mutation gate refuses a browser Origin, and leaves
# header-less local tooling (curl, the CLI, the pi-dashboard skill) untouched.
#
# The whole point of the gate is asymmetric: absent Origin → allow (no browser
# can omit it), attacker Origin → 403. A QA smoke that only checked the refusal
# would pass against a server that refused EVERYTHING, which is the regression
# that would break every local client — hence both halves here.
#
# `/api/ws-ticket` is the mutation under test because it is side-effect-free
# (mints an ephemeral single-use ticket) — a smoke test must never connect a
# tunnel or spawn a PTY to prove a gate.
#
# Needs `pi-dashboard` on PATH; SKIPS when absent.
#
# See change: fix-ws-origin-cswsh (test-plan #X5 → task 5.1).
set -euo pipefail

echo "=== Test: cross-site mutation gate (X5) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v pi-dashboard >/dev/null 2>&1; then
  echo "SKIP: pi-dashboard not on PATH"; exit 0
fi

PORT=18870
GATEWAY=19870
QA_HOME=""
SRV_PID=""

cleanup() {
  [ -n "$QA_HOME" ] && HOME="$QA_HOME" pi-dashboard stop >/dev/null 2>&1 || true
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null || true
  [ -n "$QA_HOME" ] && rm -rf "$QA_HOME" 2>/dev/null || true
}
trap cleanup EXIT

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ]; then
  echo "FAIL: something is already serving on port $PORT"; exit 1
fi

QA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/qa-origin-XXXXXX")"
mkdir -p "$QA_HOME/.pi/dashboard"

HOME="$QA_HOME" pi-dashboard start --port "$PORT" --pi-port "$GATEWAY" --no-tunnel \
  > "$QA_HOME/start.log" 2>&1 &
SRV_PID=$!

WAITED=0
while [ "$WAITED" -lt 90 ]; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ] && break
  sleep 2; WAITED=$((WAITED + 2))
done
[ "$WAITED" -lt 90 ] || { echo "FAIL: dashboard never started"; sed -n '1,40p' "$QA_HOME/start.log"; exit 1; }

# 1. Header-less local client — the shape every non-browser caller has.
STATUS="$(curl -s -o "$QA_HOME/ticket.json" -w '%{http_code}' --max-time 5 \
  -X POST -H 'Content-Type: application/json' -d '{"scope":"browser"}' \
  "http://localhost:$PORT/api/ws-ticket" 2>/dev/null || true)"
if [ "$STATUS" != "200" ]; then
  echo "FAIL: header-less POST /api/ws-ticket returned $STATUS (expected 200 — the gate must not break local tooling)"
  head -c 400 "$QA_HOME/ticket.json" 2>/dev/null || true
  exit 1
fi

# 2. The same call from a hostile page.
STATUS="$(curl -s -o "$QA_HOME/refused.json" -w '%{http_code}' --max-time 5 \
  -X POST -H 'Content-Type: application/json' -H 'Origin: http://attacker.example' \
  -d '{"scope":"browser"}' "http://localhost:$PORT/api/ws-ticket" 2>/dev/null || true)"
if [ "$STATUS" != "403" ]; then
  echo "FAIL: attacker-Origin POST /api/ws-ticket returned $STATUS (expected 403)"
  head -c 400 "$QA_HOME/refused.json" 2>/dev/null || true
  exit 1
fi

echo "PASS: header-less mutation allowed, cross-site mutation refused with 403"
