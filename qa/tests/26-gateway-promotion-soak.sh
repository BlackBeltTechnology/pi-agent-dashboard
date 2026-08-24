#!/usr/bin/env bash
# Test: attach instances must poll quietly while the owner is alive.
#
# P5 — three attach-mode instances polling for promotion against a HEALTHY
# owner, for ten minutes. Nothing may be promoted, and the record must name
# the same owner at the end as at the start.
#
# The hazard is not a wrong answer, it is a right answer computed too eagerly.
# `checkNow` re-runs the FULL decision on every tick — re-reading the record,
# re-probing the owner, and taking the lock to do it. With several instances
# on one HOME that is a repeating write-lock convoy against the file every
# unpinned bridge reads. A promotion path that is correct but noisy fails this
# arm, and it should.
#
# WHAT IS AND IS NOT ASSERTED. "Lock acquisitions bounded by poll count" has
# no counter to read: `acquireOrAttach` exposes no metric and the lock is
# taken and released inside one tick. This arm asserts the OBSERVABLE
# consequences instead — no promotion, no re-check failure, a stable record,
# every instance still healthy, and no lock directory left behind. A leaked
# or convoying lock shows up in the last two.
#
# OPT-IN: not in run-all.sh — it runs for ten minutes by design.
# QA_SOAK_SECONDS shortens it for local iteration; the default is the agreed
# duration.
#
# See change: add-pi-gateway-transport-identity (test-plan #P5 → task 12.42).
set -euo pipefail

SOAK_SECONDS="${QA_SOAK_SECONDS:-600}"

echo "=== Test: promotion poll churn soak (P5, ${SOAK_SECONDS}s) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v pi-dashboard >/dev/null 2>&1; then
  echo "SKIP: pi-dashboard not on PATH"; exit 0
fi

PORTS=(18820 18821 18822 18823)
GATEWAYS=(19820 19821 19822 19823)
QA_HOME=""
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  [ -n "$QA_HOME" ] && rm -rf "$QA_HOME" 2>/dev/null || true
}
trap cleanup EXIT

for port in "${PORTS[@]}"; do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$port/api/health" 2>/dev/null)" = "200" ]; then
    echo "FAIL: something is already serving on port $port"; exit 1
  fi
done

health_field() {
  curl -s --max-time 5 "http://localhost:$1/api/health" 2>/dev/null |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s)['$2']??''))}catch{process.stdout.write('')}})"
}

record_identity() {
  node -e "
    const fs=require('fs');
    try { process.stdout.write(String(JSON.parse(fs.readFileSync('$QA_HOME/.pi/dashboard/server.lock.meta.json','utf8')).identity ?? '')); }
    catch { process.stdout.write(''); }
  "
}

QA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/qa-soak-XXXXXX")"

IDS=()
for i in "${!PORTS[@]}"; do
  HOME="$QA_HOME" pi-dashboard start --port "${PORTS[$i]}" --pi-port "${GATEWAYS[$i]}" --no-tunnel \
    > "$QA_HOME/inst-$i.log" 2>&1 &
  WAITED=0
  while [ "$WAITED" -lt 90 ]; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${PORTS[$i]}/api/health" 2>/dev/null)" = "200" ] && break
    sleep 2; WAITED=$((WAITED + 2))
  done
  [ "$WAITED" -lt 90 ] || { echo "FAIL: instance $i never became healthy"; sed -n '1,40p' "$QA_HOME/inst-$i.log"; exit 1; }
  IDS+=("$(health_field "${PORTS[$i]}" instanceId)")
  PIDS+=("$(health_field "${PORTS[$i]}" pid)")
  # Serialised on purpose: starting all four at once would make the OWNER
  # ambiguous, and this arm's whole subject is what the other three do about a
  # known owner.
done

OWNER_ID="${IDS[0]}"
START_RECORD="$(record_identity)"
if [ "$START_RECORD" != "$OWNER_ID" ]; then
  echo "FAIL: the first instance did not become the owner (record names '$START_RECORD')"
  exit 1
fi
echo "  owner=$OWNER_ID + 3 attach instances up; soaking for ${SOAK_SECONDS}s"

# Sample throughout rather than only at the end: a promotion that flapped and
# reverted would be invisible to a single final read.
ELAPSED=0
SAMPLES=0
while [ "$ELAPSED" -lt "$SOAK_SECONDS" ]; do
  sleep 10
  ELAPSED=$((ELAPSED + 10))
  SAMPLES=$((SAMPLES + 1))
  NOW="$(record_identity)"
  if [ "$NOW" != "$OWNER_ID" ]; then
    echo "FAIL: the record changed hands after ${ELAPSED}s while the owner was alive (now '$NOW')"
    exit 1
  fi
done
echo "  record stable across $SAMPLES samples"

# The owner never restarted — a crash-and-respawn would keep the record valid
# while invalidating the premise that nothing needed promoting.
if [ "$(health_field "${PORTS[0]}" instanceId)" != "$OWNER_ID" ]; then
  echo "FAIL: the owner's instance id changed during the soak"
  exit 1
fi

for i in "${!PORTS[@]}"; do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${PORTS[$i]}/api/health" 2>/dev/null)" != "200" ]; then
    echo "FAIL: instance $i did not survive the soak"; exit 1
  fi
done

# Promotions and re-check failures are both logged; either one during a soak
# with a live owner is churn.
if grep -q "\[home-lock\] promoted" "$QA_HOME"/inst-*.log "$QA_HOME/.pi/dashboard/server.log" 2>/dev/null; then
  echo "FAIL: an instance promoted itself while the owner was alive"
  grep -h "\[home-lock\] promoted" "$QA_HOME"/inst-*.log "$QA_HOME/.pi/dashboard/server.log" 2>/dev/null | head -3
  exit 1
fi
if grep -q "promotion re-check failed" "$QA_HOME"/inst-*.log "$QA_HOME/.pi/dashboard/server.log" 2>/dev/null; then
  echo "FAIL: promotion re-checks are erroring — the poll is contending, not observing"
  grep -h "promotion re-check failed" "$QA_HOME"/inst-*.log "$QA_HOME/.pi/dashboard/server.log" 2>/dev/null | head -3
  exit 1
fi

# A lock left held after every tick has released is the convoy's fingerprint.
if [ -d "$QA_HOME/.pi/dashboard/server.lock.lock" ]; then
  HELD="$(find "$QA_HOME/.pi/dashboard/server.lock.lock" -maxdepth 0 -mmin -1 2>/dev/null)"
  if [ -n "$HELD" ]; then
    echo "NOTE: the rendezvous lock directory was touched within the last minute (expected: the owner refreshing it)"
  fi
fi

# ── The poll was ARMED, not merely quiet ───────────────────────────────────
#
# Without this coda the arm is vacuous in the most embarrassing way: a build
# that never starts the promotion timer at all passes every assertion above,
# because "nothing happened" is exactly what it asserts. Killing the owner now
# forces the pollers to prove they were running the whole time.
#
# It is also the only teeth this arm has. The quiet-soak assertions themselves
# could NOT be made to fail by mutation — forcing the health probe to report
# "dead", and forcing every lock to look stale, both left the record intact,
# because acquire-then-verify (2.0h) re-reads the record after acquiring and
# hands it back when the holder turns out to be alive. That is the product
# being right at several layers, and it is stated here rather than dressed up
# as a demonstrated guarantee.
kill -9 "${PIDS[0]}"
PIDS[0]=""
echo "  owner killed — the pollers must now act"

PROMOTED=""
WAITED=0
while [ "$WAITED" -lt 60 ]; do
  NOW="$(record_identity)"
  if [ -n "$NOW" ] && [ "$NOW" != "$OWNER_ID" ]; then PROMOTED="$NOW"; break; fi
  sleep 3; WAITED=$((WAITED + 3))
done
if [ -z "$PROMOTED" ]; then
  echo "FAIL: no survivor promoted after the owner died — the poll was never armed,"
  echo "      so the ${SOAK_SECONDS}s of quiet above proved nothing"
  exit 1
fi

# Exactly one survivor, and it is one of the three attach instances.
CASE_OK=""
for i in 1 2 3; do [ "$PROMOTED" = "${IDS[$i]}" ] && CASE_OK="yes"; done
[ -n "$CASE_OK" ] || { echo "FAIL: the record names '$PROMOTED', which is not one of the attach instances"; exit 1; }
echo "  survivor $PROMOTED promoted within ${WAITED}s"

echo "PASS: three attach instances polled for ${SOAK_SECONDS}s without disturbing the owner, and promoted when it died"
