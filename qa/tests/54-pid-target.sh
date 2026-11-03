#!/usr/bin/env bash
# Test: a recorded pid is only signalled in its own pid namespace (POSIX).
#
# test-plan #X80 (L2): two REAL `sleep 600` children. C1 is recorded as a
#   remote-origin session (`originDeviceId` set), C2 as a host-target session
#   (this host's real `buildPidNamespace()` output). Force-kill + shutdown of
#   the remote one must leave C1 alive (refused / unconfirmed orphan); force-kill
#   of the host one must remove C2 within 5 s.
# test-plan #X81 (L2, Linux + root only): a bridge inside `unshare --pid` reports
#   a different `nsId`; its pid number equal to a live host process C3 must not
#   be signalled. SKIPs (exit 0 for this section) when `unshare` is unavailable.
#
# Runs the REAL handlers and platform primitives (qa/tests/lib/pid-target-probe.ts),
# in the style of 45-windows-reclaim-refused.ps1.
# See change: scope-pids-to-namespace.
set -euo pipefail

echo "=== Test: pid target — non-local pids are never signalled (POSIX) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

sleep 600 & C1=$!; PIDS+=("$C1")
sleep 600 & C2=$!; PIDS+=("$C2")
sleep 0.3

run_probe() { QA_CASES="$1" npx --yes tsx qa/tests/lib/pid-target-probe.ts; }
field() { node -e "const l=process.argv[1].split('\n').filter(x=>x.startsWith('{')).map(JSON.parse);const r=l.find(x=>x.name===process.argv[2]&&x.action===process.argv[3]);process.stdout.write(String(r?r[process.argv[4]]:'MISSING'))" "$OUT" "$1" "$2" "$3"; }

CASES=$(cat <<JSON
[
  {"name":"remote","pid":$C1,"action":"force_kill","originDeviceId":"dev-remote-1"},
  {"name":"remote","pid":$C1,"action":"shutdown","originDeviceId":"dev-remote-1"},
  {"name":"host","pid":$C2,"action":"force_kill","pidNamespace":"self"}
]
JSON
)
OUT=$(run_probe "$CASES")
echo "$OUT"

[ "$(field remote force_kill success)" = "false" ] || { echo "FAIL: remote force_kill was not refused"; exit 1; }
[ "$(field remote shutdown orphanedPid)" = "$C1" ] || { echo "FAIL: remote shutdown did not report session_orphaned pid $C1"; exit 1; }
kill -0 "$C1" 2>/dev/null || { echo "FAIL: remote-origin pid $C1 was signalled"; exit 1; }
[ "$(field host force_kill success)" = "true" ] || { echo "FAIL: host force_kill did not succeed"; exit 1; }
if kill -0 "$C2" 2>/dev/null; then echo "FAIL: host pid $C2 survived force_kill"; exit 1; fi
echo "X80: remote-origin pid untouched; host pid killed"

# X81 — container pid namespace (Linux + unshare + root).
if [ "$(uname -s)" = "Linux" ] && command -v unshare >/dev/null 2>&1 && unshare --pid --fork --mount-proc true 2>/dev/null; then
  sleep 600 & C3=$!; PIDS+=("$C3")
  NS_JSON=$(unshare --pid --fork --mount-proc node -e "process.stdout.write(require('fs').readlinkSync('/proc/self/ns/pid'))")
  HOST_NS=$(readlink /proc/self/ns/pid)
  [ "$NS_JSON" != "$HOST_NS" ] || { echo "FAIL: unshare did not give a distinct pid namespace"; exit 1; }
  BOOT=$(cat /proc/sys/kernel/random/boot_id)
  CASES=$(cat <<JSON
[{"name":"ctr","pid":$C3,"action":"force_kill","pidNamespace":{"platform":"linux","kind":"host","hostId":"$BOOT","nsId":"$NS_JSON"}}]
JSON
)
  OUT=$(run_probe "$CASES")
  echo "$OUT"
  [ "$(field ctr force_kill success)" = "false" ] || { echo "FAIL: container-namespace force_kill was not refused"; exit 1; }
  kill -0 "$C3" 2>/dev/null || { echo "FAIL: host pid $C3 was signalled for a container-namespace session"; exit 1; }
  echo "X81: container-namespace pid untouched"
else
  echo "SKIP X81: unshare --pid unavailable (needs Linux + root)"
fi

echo "PASS: pid target (POSIX)"
