#!/usr/bin/env bash
# L2 smoke: the configured session heap ceiling reaches a REAL spawned pi
# process, binds that process only, and is not inherited by anything below it.
#
# Why these live here and not at L1: the unit tests prove the invocation the
# server BUILDS. Only a real spawn proves the invocation the kernel EXECUTES —
# that the flag is accepted, that V8 honours it, that the keeper stays uncapped,
# and that the environment carries nothing.
#
# What it proves (test-plan #X3, #X6, #X7, #X8, #X10, #X12):
#   X6   a spawned session reports heap_size_limit in [request, request+300] MB
#        and NOT the server's ceiling
#   X7   the ceiling is absent from the session's environment, so a Node tool
#        the agent starts is not capped
#   X8   pi carries the flag in argv; the supervising keeper does not
#   X10  lowering the ceiling leaves running sessions untouched
#   X3   a resolution with no runtime slot records a fallback in the server log
#        AND on /api/health
#   X12  a stripped environment still yields a stamped server ceiling
#
# Assumes a `pi-dashboard` server is startable on :8000 and that `pi` resolves.
#
# See change: bound-session-heap-and-gc-telemetry.

set -euo pipefail

echo "=== Test: session heap ceiling ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

BASE=http://localhost:8000
CONFIG_PATH="$HOME/.pi/dashboard/config.json"
OVERRIDES_PATH="$HOME/.pi/dashboard/tool-overrides.json"
LOG_PATH="$HOME/.pi/dashboard/server.log"
WORKDIR="$(mktemp -d)"

CONFIG_BACKUP=""
[ -f "$CONFIG_PATH" ] && CONFIG_BACKUP="$(cat "$CONFIG_PATH")"
OVERRIDES_BACKUP=""
[ -f "$OVERRIDES_PATH" ] && OVERRIDES_BACKUP="$(cat "$OVERRIDES_PATH")"

fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  pi-dashboard stop >/dev/null 2>&1 || true
  if [ -n "$CONFIG_BACKUP" ]; then printf '%s' "$CONFIG_BACKUP" > "$CONFIG_PATH"; else rm -f "$CONFIG_PATH"; fi
  if [ -n "$OVERRIDES_BACKUP" ]; then printf '%s' "$OVERRIDES_BACKUP" > "$OVERRIDES_PATH"; else rm -f "$OVERRIDES_PATH"; fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

boot_with_config() {
  pi-dashboard stop >/dev/null 2>&1 || true
  sleep 2
  mkdir -p "$(dirname "$CONFIG_PATH")"
  printf '%s' "$1" > "$CONFIG_PATH"
  : > "$LOG_PATH"
  pi-dashboard start >/dev/null 2>&1 &
  local waited=0
  while [ $waited -lt 20 ]; do
    curl -fsS "$BASE/api/health" >/dev/null 2>&1 && return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# `jq` is not guaranteed on every QA image; node always is (it runs the server).
jnode() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}process.stdout.write(String($1))})"; }
health() { curl -fsS "$BASE/api/health" 2>/dev/null; }

spawn_session() {
  curl -fsS -X POST "$BASE/api/session/spawn" \
    -H 'Content-Type: application/json' \
    -d "{\"cwd\":\"$1\"}" 2>/dev/null
}

# Wait until at least one agent has reported metrics carrying a heap ceiling.
wait_for_agent_heap() {
  local waited=0
  while [ $waited -lt 40 ]; do
    local n
    n=$(health | jnode "(j.agents||[]).filter(a=>typeof a.heapSizeLimit==='number').length" || echo 0)
    [ "${n:-0}" -ge 1 ] && return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

agent_heap_mb() {
  health | jnode "Math.round(((j.agents||[]).find(a=>typeof a.heapSizeLimit==='number')||{}).heapSizeLimit/1048576)"
}
server_heap_mb() { health | jnode "Math.round(j.server.heapSizeLimit/1048576)"; }

# ── X6 — the ceiling reaches the process ───────────────────────────────────
boot_with_config '{"port":8000,"spawnStrategy":"headless","sessionHeap":{"maxOldSpaceMb":512},"serverHeap":{"maxOldSpaceMb":2048}}' \
  || fail "server did not come up for the #X6 check"

spawn_session "$WORKDIR" >/dev/null || fail "#X6: session spawn request failed"
wait_for_agent_heap || fail "#X6: no agent reported heapSizeLimit within 40s"

SESSION_MB=$(agent_heap_mb)
SERVER_MB=$(server_heap_mb)
# V8 adds a fixed overhead (~192 MB observed) to the request, so the assertion
# is a band, not an equality — an exact match would break on a runtime upgrade
# that is not a behavioural regression.
if [ "$SESSION_MB" -lt 512 ] || [ "$SESSION_MB" -gt 812 ]; then
  fail "#X6: session heap_size_limit ${SESSION_MB} MB outside [512, 812]"
fi
if [ "$SESSION_MB" = "$SERVER_MB" ]; then
  fail "#X6: session ceiling ${SESSION_MB} MB equals the server's — the session inherited it"
fi
echo "#X6: session at ${SESSION_MB} MB, server at ${SERVER_MB} MB"

# ── X7 / X8 — argv carries it; the environment and the keeper do not ───────
PI_PID=$(health | jnode "((j.agents||[])[0]||{}).pid || ''")
if [ -z "$PI_PID" ]; then
  # `agents[]` is keyed on session metrics, which may not carry a pid on every
  # platform; fall back to a process scan for the flag.
  PI_PID=$(pgrep -f -- "--max-old-space-size=512" | head -1 || true)
fi
[ -n "$PI_PID" ] || fail "#X8: could not locate the spawned pi process"

PI_ARGS=$(ps -o args= -p "$PI_PID" 2>/dev/null || true)
case "$PI_ARGS" in
  *--max-old-space-size=512*) echo "#X8: pi argv carries the ceiling" ;;
  *) fail "#X8: pi argv does not carry --max-old-space-size=512: $PI_ARGS" ;;
esac

# X7 — nothing in the session's ENVIRONMENT carries the ceiling. This is the
# property that keeps an agent's vitest/tsc/vite subprocesses at the runtime
# default; an env-borne cap would reach every one of them.
if [ -r "/proc/$PI_PID/environ" ]; then
  PI_ENV=$(tr '\0' '\n' < "/proc/$PI_PID/environ" | grep '^NODE_OPTIONS=' || true)
else
  PI_ENV=$(ps eww -p "$PI_PID" 2>/dev/null | tr ' ' '\n' | grep '^NODE_OPTIONS=' || true)
fi
case "$PI_ENV" in
  *max-old-space-size*) fail "#X7: the session environment carries a heap flag: $PI_ENV" ;;
  *) echo "#X7: no heap flag in the session environment (${PI_ENV:-NODE_OPTIONS unset})" ;;
esac

# X8 (second half) — the keeper supervises pi and must NOT be capped. A capped
# supervisor is the failure mode the argv transport exists to avoid.
KEEPER_PIDS=$(pgrep -f "keeper.cjs" || true)
for kp in $KEEPER_PIDS; do
  KARGS=$(ps -o args= -p "$kp" 2>/dev/null || true)
  case "$KARGS" in
    *--max-old-space-size=512*) fail "#X8: keeper pid $kp is capped at the session ceiling" ;;
  esac
done
echo "#X8: no keeper process carries the session ceiling"

# ── X10 — a config change does not resize a running process ────────────────
curl -fsS -X PUT "$BASE/api/config" -H 'Content-Type: application/json' \
  -d '{"sessionHeap":{"maxOldSpaceMb":256}}' >/dev/null 2>&1 \
  || fail "#X10: config write failed"
sleep 3
AFTER_MB=$(agent_heap_mb)
if [ "$AFTER_MB" != "$SESSION_MB" ]; then
  fail "#X10: running session moved from ${SESSION_MB} MB to ${AFTER_MB} MB"
fi
echo "#X10: running session kept ${SESSION_MB} MB after the ceiling was lowered"

# ── X12 — a stripped environment still produces a stamped server ───────────
# The strip removes the dashboard's own flag from every child env, so a server
# a pi session later bridge-launches inherits NOTHING. Without its own stamp it
# would fall to the bare V8 default on exactly the recovery path where the
# event store is hottest. Simulated directly: boot with the flag and the
# provenance marker absent from the environment.
pi-dashboard stop >/dev/null 2>&1 || true
sleep 2
printf '%s' '{"port":8000,"serverHeap":{"maxOldSpaceMb":2048}}' > "$CONFIG_PATH"
: > "$LOG_PATH"
env -u NODE_OPTIONS -u PI_DASHBOARD_HEAP_FLAG pi-dashboard start >/dev/null 2>&1 &
waited=0
while [ $waited -lt 20 ]; do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
  waited=$((waited + 1))
done
EFFECTIVE=$(health | jnode "j.server.effectiveMaxOldSpaceMb")
if [ "$EFFECTIVE" != "2048" ]; then
  fail "#X12: a server started from a stripped environment reported '$EFFECTIVE', expected 2048"
fi
echo "#X12: stripped environment still yields the configured 2048 ceiling"

# ── X3 — a resolution with no runtime slot is RECORDED, never silent ───────
# Fault injection: point the `pi` tool override at a POSIX shell wrapper. It is
# not a `.js` and does not dereference to one, so the resolver returns a bare
# single-element invocation with nowhere to put a V8 flag.
WRAPPER="$WORKDIR/pi-wrapper.sh"
cat > "$WRAPPER" <<'WRAP'
#!/bin/sh
# Not a Node script: there is no runtime slot to place V8 flags into.
exec sleep 30
WRAP
chmod +x "$WRAPPER"
mkdir -p "$(dirname "$OVERRIDES_PATH")"
printf '{"pi":"%s"}' "$WRAPPER" > "$OVERRIDES_PATH"

boot_with_config '{"port":8000,"spawnStrategy":"headless","sessionHeap":{"maxOldSpaceMb":512}}' \
  || fail "server did not come up for the #X3 check"
spawn_session "$WORKDIR" >/dev/null 2>&1 || true
sleep 5

FALLBACK_USED=$(health | jnode "j.sessionHeapFallback && j.sessionHeapFallback.used")
if [ "$FALLBACK_USED" != "true" ]; then
  fail "#X3: health did not report the fallback in use (got '$FALLBACK_USED')"
fi
if ! grep -q "\[heap\]" "$LOG_PATH"; then
  fail "#X3: no [heap] fallback line in $LOG_PATH"
fi
echo "#X3: fallback recorded in the server log AND on /api/health"

echo "PASS: session heap ceiling"
