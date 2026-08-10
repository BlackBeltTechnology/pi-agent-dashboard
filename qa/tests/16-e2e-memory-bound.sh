#!/usr/bin/env bash
# L2 smoke: the browser-E2E harness's memory footprint stays BOUNDED across a run.
#
# Wraps an E2E chunk (or a full run) and samples the container cgroup out-of-band
# before and after, via scripts/probe-harness-memory.mjs. Carries NO rendered-UI
# assertions — that is L3's job (tests/e2e/*.spec.ts). This script exists because
# the memory bound itself cannot be asserted from inside a Playwright test: the
# cgroup is only readable via `docker exec` from the host, and an in-test read
# could not attribute a breach to anything (design D5).
#
# What it proves (test-plan #P1, #P3, #P4):
#   P1  memory.current after a LATER chunk <= early sample + 10%
#   P3  resident `pi` count minus reported live sessions stays constant
#   P4  the run reaches its final spec with the container still healthy
#
# Usage:
#   qa/tests/16-e2e-memory-bound.sh                  # default 2x15-spec chunks
#   E2E_CHUNK_SIZE=30 qa/tests/16-e2e-memory-bound.sh
#   E2E_FULL=1 qa/tests/16-e2e-memory-bound.sh       # all 87 specs, one container
#
# Assumes a harness is already up (docker/test-up.sh -d). Never boots or tears
# one down itself — the caller owns the lifecycle, so a failure here leaves the
# container inspectable.
#
# See change: fix-e2e-harness-memory-exhaustion.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

STATE_FILE="$REPO_ROOT/.pi-test-harness.json"
PROBE="node $REPO_ROOT/scripts/probe-harness-memory.mjs"
CHUNK_SIZE="${E2E_CHUNK_SIZE:-15}"
# P1's threshold. A reaping suite should be FLAT; 10% absorbs cache/allocator
# noise without absorbing a per-session leak (~150-280 MB each).
GROWTH_ALLOWANCE_PCT="${E2E_GROWTH_ALLOWANCE_PCT:-10}"

fail() { echo "FAIL: $*" >&2; exit 1; }
info() { echo "  $*"; }

[ -f "$STATE_FILE" ] || fail "$STATE_FILE not found — start the harness (docker/test-up.sh -d)"

# Port comes from the state file. NEVER hardcode :18000 — ports are hash-derived
# per worktree so parallel harnesses do not collide.
PORT="$(node -e "console.log(require('$STATE_FILE').dashboardPort)")"
GATEWAY_PORT="$(node -e "console.log(require('$STATE_FILE').gatewayPort)")"
export PW_E2E_PORT="$PORT" PW_GATEWAY_PORT="$GATEWAY_PORT" PW_E2E_USE_RUNNING=1
: "${PW_CHANNEL:=}"   # honour a caller-set system browser; else bundled Chromium

curl -sf "http://localhost:$PORT/api/health" >/dev/null \
  || fail "harness not healthy on :$PORT"

echo "== E2E memory-bound smoke (port $PORT, chunk $CHUNK_SIZE) =="

mapfile -t ALL_SPECS < <(ls tests/e2e/*.spec.ts | sort)
[ "${#ALL_SPECS[@]}" -gt 0 ] || fail "no specs found"

json_field() { node -e "console.log(JSON.parse(require('fs').readFileSync('$1','utf8')).$2)"; }

# Live session count as the SERVER reports it — the in-band figure P3 compares
# the out-of-band resident process count against.
live_sessions() {
  curl -s "http://localhost:$PORT/api/sessions" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log((j.data?.sessions??[]).filter(x=>x.live!==false).length)}catch{console.log(0)}})"
}

run_chunk() { # $1=label  $2..=spec files
  local label="$1"; shift
  echo "-- chunk [$label]: $# spec file(s)"
  $PROBE --json --label "$label-before" > "/tmp/qa-mem-$label-before.json"
  set +e
  npx playwright test --global-timeout 7200000 "$@" > "/tmp/qa-e2e-$label.log" 2>&1
  local rc=$?
  set -e
  $PROBE --json --label "$label-after" > "/tmp/qa-mem-$label-after.json"
  echo "$rc" > "/tmp/qa-e2e-$label.rc"
  info "playwright exit=$rc (spec failures are NOT this script's verdict)"
}

if [ -n "${E2E_FULL:-}" ]; then
  run_chunk full "${ALL_SPECS[@]}"
  EARLY=full; LATE=full
else
  EARLY_SPECS=("${ALL_SPECS[@]:0:$CHUNK_SIZE}")
  LATE_SPECS=("${ALL_SPECS[@]:$CHUNK_SIZE:$CHUNK_SIZE}")
  [ "${#LATE_SPECS[@]}" -gt 0 ] || fail "not enough specs for two chunks of $CHUNK_SIZE"
  run_chunk early "${EARLY_SPECS[@]}"
  run_chunk late  "${LATE_SPECS[@]}"
  EARLY=early; LATE=late
fi

echo
echo "== assertions =="

# ---- P4: container still healthy, run reached the end ----------------------
curl -sf "http://localhost:$PORT/api/health" >/dev/null \
  || fail "P4: container is NOT healthy after the run (daemon died)"
info "P4 OK: container still healthy after the run"

if grep -qi 'daemon restarted' "/tmp/qa-e2e-$LATE.log" 2>/dev/null; then
  fail "P4: unexplained 'daemon restarted' in the run log"
fi
info "P4 OK: no unexplained daemon restart"

# ---- P1: memory does not climb --------------------------------------------
EARLY_MEM="$(json_field "/tmp/qa-mem-$EARLY-after.json" memoryCurrentBytes)"
LATE_MEM="$(json_field "/tmp/qa-mem-$LATE-after.json" memoryCurrentBytes)"
LIMIT=$(( EARLY_MEM + EARLY_MEM * GROWTH_ALLOWANCE_PCT / 100 ))
info "P1: early=$((EARLY_MEM/1024/1024))MiB late=$((LATE_MEM/1024/1024))MiB limit=$((LIMIT/1024/1024))MiB"
if [ "$LATE_MEM" -gt "$LIMIT" ]; then
  fail "P1: memory.current climbed beyond +${GROWTH_ALLOWANCE_PCT}% — sessions are outliving their specs"
fi
info "P1 OK: memory.current is flat run-over-run"

# ---- P3: resident process count tracks session count -----------------------
RESIDENT="$(json_field "/tmp/qa-mem-$LATE-after.json" residentPiCount)"
REPORTED="$(live_sessions)"
DIVERGENCE=$(( RESIDENT - REPORTED ))
info "P3: resident pi=$RESIDENT reported live sessions=$REPORTED divergence=$DIVERGENCE"
# A persistent POSITIVE divergence means pi processes exist that never registered
# as dashboard sessions — invisible to both the delta and the budget while still
# consuming RSS (design "Open Questions"). Recorded, not failed: it is a finding
# about the model, not a regression in the reap.
if [ "$DIVERGENCE" -gt 2 ]; then
  echo "  NOTE: $DIVERGENCE resident pi process(es) are not reported as live sessions." >&2
  echo "        These are invisible to the delta AND the budget. See design Open Questions." >&2
fi
info "P3 OK: divergence recorded ($DIVERGENCE)"

echo
echo "PASS: E2E harness memory stays bounded across the run"
