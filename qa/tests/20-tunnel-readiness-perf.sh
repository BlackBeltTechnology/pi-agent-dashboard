#!/usr/bin/env bash
# Test: per-provider readiness tick latency + concurrent-tunnel soak.
#
# Folded from test-plan.md (add-zrok-custom-reserved-name): P1, P3, X12.
#
# Readiness shells out once per provider per tick, from an interactive surface
# polling every 5s. That is affordable only if a tick stays well inside the
# interval, so the budget is a GATE, not a report: if p95 approaches the poll
# interval, the cadence has to move before the feature ships.
#
# Windows/soak note: the 30-minute P3 soak and the X12 watchdog-recycle arm need
# two REAL enrolled providers, which no CI runner has. They run only when
# PI_QA_TUNNEL_SOAK=1 and the operator has enrolled them; otherwise they are
# skipped loudly rather than silently passing.
set -euo pipefail

echo "=== Test: readiness tick latency (P1) ==="

PORT="${PI_QA_PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"

# ── P1: p95 < 2s per tick, cold registry cache ──────────────────────
# The budget is per TICK across all known providers. Sampled over a window
# rather than once: a single sample cannot distinguish a slow tick from a slow
# machine, and p95 is the number the spec fixes.
SAMPLES=${PI_QA_READINESS_SAMPLES:-20}
BUDGET_MS=2000

if ! curl -fsS --max-time 15 --connect-timeout 5 "${BASE}/api/health" >/dev/null 2>&1; then
  echo "SKIP: no dashboard server on ${BASE} (start one, or set PI_QA_PORT)"
  exit 0
fi

tmp=$(mktemp)
body=$(mktemp)
trap 'rm -f "$tmp" "$body"' EXIT

# A 200 is NOT proof the route exists. The dashboard serves the SPA shell as a
# catch-all, so an unknown /api path returns 200 text/html in ~1ms — which would
# make every latency assertion below pass against a server that does not have
# this endpoint at all. Verify the payload SHAPE before trusting any timing.
# Bounded: an unbounded probe against a wedged server hangs the QA run forever.
CURL_BOUND=(--max-time 15 --connect-timeout 5)
probe_ct=$(curl -s "${CURL_BOUND[@]}" -o "$body" -w '%{content_type}' "${BASE}/api/tunnel-readiness" 2>/dev/null || echo "")
case "$probe_ct" in
  application/json*) ;;
  *)
    echo "FAIL: /api/tunnel-readiness returned '${probe_ct:-no response}', not JSON."
    echo "      The SPA catch-all answers unknown /api paths with 200 text/html, so this"
    echo "      almost certainly means the server predates the readiness endpoint."
    exit 1
    ;;
esac
# An ARRAY, not merely the key: `{"providers":null}` would satisfy a key check
# while carrying no board at all.
if ! node -e '
  const b = require("node:fs").readFileSync(process.argv[1], "utf8");
  let j; try { j = JSON.parse(b); } catch { process.exit(2); }
  process.exit(Array.isArray(j?.data?.providers) ? 0 : 3);
' "$body"; then
  echo "FAIL: readiness response carried no providers ARRAY:"
  head -c 200 "$body"; echo
  exit 1
fi

echo "Sampling ${SAMPLES} readiness ticks against ${BASE}…"
for _ in $(seq 1 "${SAMPLES}"); do
  # %{time_total} is seconds with microsecond resolution; convert to ms.
  t=$(curl -fsS "${CURL_BOUND[@]}" -o /dev/null -w '%{time_total}' "${BASE}/api/tunnel-readiness" 2>/dev/null || echo "")
  if [ -z "$t" ]; then
    echo "FAIL: /api/tunnel-readiness did not respond"
    exit 1
  fi
  awk -v t="$t" 'BEGIN { printf "%.0f\n", t * 1000 }' >> "$tmp"
done

read -r P50 P95 MAX <<EOF
$(sort -n "$tmp" | awk '
  { a[NR] = $1 }
  END {
    p50 = a[int(NR * 0.50) + (int(NR * 0.50) < 1 ? 1 : 0)]
    i95 = int(NR * 0.95); if (i95 < 1) i95 = 1
    print p50, a[i95], a[NR]
  }')
EOF

echo "readiness tick: p50=${P50}ms p95=${P95}ms max=${MAX}ms (budget p95 < ${BUDGET_MS}ms)"
if [ "${P95}" -ge "${BUDGET_MS}" ]; then
  echo "FAIL: p95 ${P95}ms exceeds the ${BUDGET_MS}ms budget."
  echo "      A tick that approaches the 5s poll interval means the CADENCE must move,"
  echo "      or the per-provider cost must come down, before this ships."
  exit 1
fi
echo "PASS: readiness tick within budget"

# ── P2 (shape): a hung provider must not stall the whole report ─────
# The 4s per-predicate bound is asserted at L1; here we only check the endpoint
# cannot exceed a whole poll interval end-to-end, which is the operator-visible
# consequence of that bound being real.
if [ "${MAX}" -ge 5000 ]; then
  echo "FAIL: a tick took ${MAX}ms, at or beyond the 5s poll interval —"
  echo "      overlap suppression would starve the board."
  exit 1
fi
echo "PASS: no tick reached the poll interval"

# ── P3 / X12: concurrent-tunnel soak ────────────────────────────────
if [ "${PI_QA_TUNNEL_SOAK:-0}" != "1" ]; then
  echo "SKIP: P3 soak + X12 watchdog recycle need two REAL enrolled providers."
  echo "      Enrol zrok (public, primary) + tailscale (private), then re-run with"
  echo "      PI_QA_TUNNEL_SOAK=1. Skipped loudly on purpose: a soak that silently"
  echo "      passes because nothing was running is worse than no soak."
  exit 0
fi

echo "=== Test: concurrent-tunnel soak (P3) ==="
SOAK_MIN=${PI_QA_SOAK_MINUTES:-30}
RSS_GROWTH_PCT=10

pid_of_server() { curl -fsS "${CURL_BOUND[@]}" "${BASE}/api/health" | sed -n 's/.*"pid":\([0-9]*\).*/\1/p'; }
rss_kb() { ps -o rss= -p "$1" 2>/dev/null | tr -d ' '; }
child_pids() { ls "${HOME}/.pi/dashboard"/*.pid 2>/dev/null | wc -l | tr -d ' '; }

SRV=$(pid_of_server)
[ -n "$SRV" ] || { echo "FAIL: could not read server pid from /api/health"; exit 1; }

RSS0=$(rss_kb "$SRV")
PIDS0=$(child_pids)
URLS0=$(curl -fsS "${CURL_BOUND[@]}" "${BASE}/api/tunnel/endpoints" | grep -o 'https\?://[^"]*' | sort -u)
echo "start: rss=${RSS0}KB pidfiles=${PIDS0}"
echo "$URLS0" | sed 's/^/  reachable: /'

END=$(( $(date +%s) + SOAK_MIN * 60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  curl -fsS "${CURL_BOUND[@]}" -o /dev/null "${BASE}/api/tunnel-readiness" || true
  sleep 5
done

RSS1=$(rss_kb "$SRV")
PIDS1=$(child_pids)
URLS1=$(curl -fsS "${CURL_BOUND[@]}" "${BASE}/api/tunnel/endpoints" | grep -o 'https\?://[^"]*' | sort -u)
echo "end:   rss=${RSS1}KB pidfiles=${PIDS1}"

# A PID-file leak is the failure mode per-provider naming exists to prevent.
if [ "${PIDS1}" -gt "${PIDS0}" ]; then
  echo "FAIL: pid-file count grew ${PIDS0} → ${PIDS1} (leaked child tunnel)"
  exit 1
fi

GROWTH=$(awk -v a="$RSS0" -v b="$RSS1" 'BEGIN { printf "%.1f", (b - a) * 100.0 / a }')
echo "rss growth: ${GROWTH}% (budget < ${RSS_GROWTH_PCT}%)"
if awk -v g="$GROWTH" -v m="$RSS_GROWTH_PCT" 'BEGIN { exit !(g >= m) }'; then
  echo "FAIL: RSS grew ${GROWTH}% over ${SOAK_MIN}min of polling"
  exit 1
fi

# Both tunnels must still be reachable — a soak that ends with one provider
# quietly gone has not demonstrated concurrency.
if [ "$URLS0" != "$URLS1" ]; then
  echo "FAIL: reachable tunnel URLs changed during the soak"
  diff <(echo "$URLS0") <(echo "$URLS1") || true
  exit 1
fi

echo "PASS: concurrent-tunnel soak"

# ── X12: a watchdog recycle must not disturb the OTHER provider ──────
echo "=== Test: watchdog recycle isolation (X12) ==="
mapfile -t PIDFILES < <(ls "${HOME}/.pi/dashboard"/*.pid 2>/dev/null)
if [ "${#PIDFILES[@]}" -lt 2 ]; then
  echo "SKIP: X12 needs two CHILD-model tunnels live (zrok + ngrok); found ${#PIDFILES[@]} pid file(s)."
  echo "      Daemon providers (tailscale/zerotier) carry no pid file by design,"
  echo "      so a zrok+tailscale pair cannot exercise this arm."
  exit 0
fi

VICTIM="${PIDFILES[0]}"; OTHER="${PIDFILES[1]}"
OTHER_PID_BEFORE=$(cat "$OTHER")
echo "killing $(basename "$VICTIM") ($(cat "$VICTIM")); watching $(basename "$OTHER") (${OTHER_PID_BEFORE})"
kill "$(cat "$VICTIM")" 2>/dev/null || true

# Give the watchdog a full interval plus slack to notice and recycle.
sleep 90

OTHER_PID_AFTER=$(cat "$OTHER" 2>/dev/null || echo "")
if [ "$OTHER_PID_AFTER" != "$OTHER_PID_BEFORE" ]; then
  echo "FAIL: the OTHER provider's pid changed ${OTHER_PID_BEFORE} → ${OTHER_PID_AFTER:-gone}."
  echo "      One provider's recycle reaped another's process — the exact failure"
  echo "      per-provider pid naming exists to prevent."
  exit 1
fi
if ! kill -0 "$OTHER_PID_BEFORE" 2>/dev/null; then
  echo "FAIL: the other provider's process ${OTHER_PID_BEFORE} is gone after the recycle"
  exit 1
fi
echo "PASS: recycle isolation — the other provider's pid is untouched and alive"
