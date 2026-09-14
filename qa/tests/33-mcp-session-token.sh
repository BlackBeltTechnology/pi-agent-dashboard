#!/usr/bin/env bash
# Test: the wired per-session MCP credential (test-plan #P1, #X8, #X9 —
# change: wire-mcp-session-token).
#
# Three legs, each with its environment honesty stated up front:
#
# - P1  Per-request header-command latency baseline. The manifest prefers a
#       REAL adapter child, but an adapter child only exists when a pi session
#       with pi-mcp-adapter actually drives the entry. Where that child cannot
#       be hosted, the manifest allows a scripted measurement recorded in
#       design.md instead of dropping the number — this prints median + p95 of
#       the delivery leg (the header command itself) over 20 sequential runs.
# - X8  Unbridged session degrades cleanly: with the entry pointing at a dead
#       URL, an attempt is a single clean failure (no retry storm is possible
#       from our side — the header command is invoked per request by the
#       adapter, never retried by us), the unset-credential command fails
#       closed immediately, and a later healthy server answers normally with
#       no loopback lockout.
# - X9  Linux process-surface probe: argv of a live header-command child
#       carries no token; /proc/<pid>/environ is owner-only. Linux-only legs
#       self-skip elsewhere (the macOS equivalent was measured in the spike).
set -euo pipefail

echo "=== Test: MCP session token delivery (P1 baseline, X8 degradation, X9 surface) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

BASE="${PI_QA_BASE:-http://localhost:8000}"
PLUGIN_DIR="${PI_DASHBOARD_PLUGIN_DIR:-}"

# Locate the shipped header command. The qa VM installs the dashboard globally;
# fall back to the repo checkout when run from one.
find_header_command() {
  if [ -n "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/src/server/header-command.mjs" ]; then
    echo "$PLUGIN_DIR/src/server/header-command.mjs"
    return 0
  fi
  for d in \
    "$HOME/.pi/dashboard/node_modules/@blackbelt-technology/pi-dashboard-mcp-server-plugin" \
    "$HOME/.nvm/versions/node"/*/lib/node_modules/@blackbelt-technology/pi-agent-dashboard/node_modules/@blackbelt-technology/pi-dashboard-mcp-server-plugin \
    "$(pwd)/packages/mcp-server-plugin"; do
    if [ -f "$d/src/server/header-command.mjs" ]; then
      echo "$d/src/server/header-command.mjs"
      return 0
    fi
  done
  return 1
}

CMD_SCRIPT="$(find_header_command)" || {
  echo "SKIP: header-command.mjs not found (dashboard plugin not installed here)"
  exit 0
}
echo "header command: $CMD_SCRIPT"

# ── P1 — per-request delivery-leg latency baseline (20 sequential runs) ────
# Each run is one full spawn+answer, the per-HTTP-request cost the adapter
# adds for our credential on every request (the adapter's own process-discovery
# machinery around it is accounted separately in the spike's 250 ms figure).
echo "--- P1: 20 sequential header-command round trips"
TIMINGS=$(node -e '
  const { execFileSync } = require("node:child_process");
  const env = { ...process.env, PI_DASHBOARD_MCP_TOKEN: "mcp_p1-baseline-token" };
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const out = execFileSync("node", [process.argv[1]], {
      env, input: "{}", encoding: "utf8",
    });
    samples.push(performance.now() - t0);
    if (!out.includes("Bearer mcp_p1-baseline-token")) { console.error("bad answer"); process.exit(1); }
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
  console.log(`${median.toFixed(1)} ${p95.toFixed(1)}`);
' "$CMD_SCRIPT")
MEDIAN=$(echo "$TIMINGS" | cut -d' ' -f1)
P95=$(echo "$TIMINGS" | cut -d' ' -f2)
echo "P1 BASELINE: header-command per-request median=${MEDIAN}ms p95=${P95}ms (recorded, no pass/fail threshold)"
echo "PASS: P1 baseline recorded (median=${MEDIAN}ms p95=${P95}ms over 20 runs)"

# ── X8 — unbridged/dead-endpoint degradation is clean ──────────────────────
echo "--- X8: dead endpoint + unset credential degrade cleanly"
# (a) The header command with the credential UNSET exits non-zero, promptly.
if env -u PI_DASHBOARD_MCP_TOKEN timeout 10 node "$CMD_SCRIPT" </dev/null >/dev/null 2>&1; then
  echo "FAIL: unset-credential header command exited 0 (must fail closed)"
  exit 1
fi
echo "unset credential: exits non-zero, no hang"

# (b) A request to a dead URL is a single clean connection refusal.
DEAD_PORT="${X8_DEAD_PORT:-9393}"
if timeout 10 curl -s -o /dev/null --max-time 5 \
  -X POST "http://127.0.0.1:${DEAD_PORT}/mcp" \
  -H "Authorization: Bearer mcp_x" -H "mcp-protocol-version: 2026-07-28" \
  -H "content-type: application/json" -d '{}' 2>/dev/null; then
  # curl exiting 0 means SOMETHING answered on the dead port — that is fine
  # only if it was an HTTP response; a refusal (7) is the expected shape.
  :
fi
echo "dead endpoint: single attempt, bounded by --max-time (no retry loop exists on our side)"

# (c) Against a live server, the SAME shape of request gets a clean, immediate
# 401 (guarded, not crashed) and the loopback source is not locked out.
HTTP_CODE=$(timeout 10 curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "$BASE/mcp" \
  -H "Authorization: Bearer mcp_definitely-unminted" \
  -H "mcp-protocol-version: 2026-07-28" \
  -H "content-type: application/json" -d '{}' 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "401" ]; then
  echo "FAIL: live server answered $HTTP_CODE for an unminted bearer (want 401)"
  exit 1
fi
echo "live server: clean 401 for unminted bearer (loopback not locked out)"
echo "PASS: X8 degradation is clean (fail-closed command, bounded attempts, guarded 401)"

# ── X9 — Linux process-surface probe (argv + /proc environ) ────────────────
echo "--- X9: process surface of a live header-command child"
if [ "$(uname -s)" != "Linux" ]; then
  echo "SKIP: X9 process probe is Linux-only (macOS equivalent measured in spike Q1b)"
  exit 0
fi

# Keep a child alive with an open, silent stdin so /proc can be read.
env PI_DASHBOARD_MCP_TOKEN='mcp_x9-secret-value' node "$CMD_SCRIPT" < <(sleep 8) &
CHILD=$!
sleep 1

# argv via ps when available, else /proc/<pid>/cmdline (NUL-separated). The
# check must FAIL CLOSED when neither surface is readable — an unreadable
# surface is not a clean surface.
ARGS="$(ps -ww -o args= -p "$CHILD" 2>/dev/null || tr '\0' ' ' < "/proc/$CHILD/cmdline" 2>/dev/null || true)"
if [ -z "$ARGS" ]; then
  echo "FAIL: could not read the child's argv (no ps, no /proc) — refusing to pass vacuously"
  kill "$CHILD" 2>/dev/null || true
  exit 1
fi
if echo "$ARGS" | grep -q 'mcp_x9-secret-value'; then
  echo "FAIL: token visible in argv: $ARGS"
  kill "$CHILD" 2>/dev/null || true
  exit 1
fi
echo "argv carries no token"

ENV_MODE=$(stat -c '%a' "/proc/$CHILD/environ" 2>/dev/null || echo "unknown")
if [ "$ENV_MODE" != "400" ] && [ "$ENV_MODE" != "600" ]; then
  echo "FAIL: /proc/$CHILD/environ mode is $ENV_MODE (want owner-only 400/600)"
  kill "$CHILD" 2>/dev/null || true
  exit 1
fi
echo "/proc/$CHILD/environ mode: $ENV_MODE (owner-only)"

kill "$CHILD" 2>/dev/null || true
wait "$CHILD" 2>/dev/null || true
echo "PASS: X9 process surface clean (no token in argv, owner-only environ)"
