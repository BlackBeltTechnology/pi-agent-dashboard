#!/usr/bin/env bash
# Test: a record naming one instance, an endpoint answering as another.
#
# This is the only question no local credential can answer. The socket's 0600
# mode (D5) and the Windows local token (D6) both authorise a HOST, and every
# same-HOME dashboard passes them equally. If the rendezvous record names
# instance A and something else answers at that endpoint, only the published
# `instanceId` can tell — and adopting the answer anyway is the endpoint
# ambiguity this whole change exists to remove (D14).
#
# `decideAdoption` is enumerated in unit tests. What those cannot show is that
# the WIRING acts on the verdict: a pure function returning `conflict: true`
# proves nothing if the caller ignores it. So this arm drives a real pi over
# the real record path and reads what the bridge actually did.
#
# Two arms, because a refusal that always fires is as broken as one that never
# does: the control arm asserts an untampered record produces NO refusal.
#
# tasks 5.4b, 3.8, 10.2 · design D14
# See change: add-pi-gateway-transport-identity.

set -u

PORT="${DASHBOARD_PORT:-18870}"
GATEWAY="${PI_GATEWAY_PORT:-19870}"
QA_HOME=""
SRV_PID=""
FAKE_ID="deadbeef-0000-4000-8000-000000000000"

echo "=== Test: instance identity beats a same-HOME credential ==="

cleanup() {
  if [ -n "$SRV_PID" ]; then kill -9 "$SRV_PID" 2>/dev/null || true; fi
  if [ -n "$QA_HOME" ]; then rm -rf "$QA_HOME" 2>/dev/null || true; fi
}
trap cleanup EXIT

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ]; then
  echo "FAIL: something is already serving on port $PORT — refusing to test against it"
  exit 1
fi

# The pi that will dial. A dashboard-SPAWNED session is useless here: it gets
# PI_DASHBOARD_SOCKET/URL, which outrank the record, so it never takes the path
# under test. Only a pi launched by hand resolves through the record.
PI_BIN="${QA_PI_BIN:-}"
if [ -z "$PI_BIN" ]; then
  PI_BIN="$(command -v pi 2>/dev/null || true)"
fi
if [ -z "$PI_BIN" ] && [ -x "$HOME/.pi-dashboard/node_modules/.bin/pi" ]; then
  PI_BIN="$HOME/.pi-dashboard/node_modules/.bin/pi"
fi
if [ -z "$PI_BIN" ] || [ ! -x "$PI_BIN" ]; then
  echo "SKIP: no pi binary found (set QA_PI_BIN) — this arm needs a real bridge, not a stub"
  exit 0
fi

REPO_ROOT="${QA_REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
EXT_DIR="$REPO_ROOT/packages/extension"
if [ ! -d "$EXT_DIR" ]; then
  echo "FAIL: extension source not found at $EXT_DIR"
  exit 1
fi

QA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/qa-instance-mismatch-XXXXXX")"
mkdir -p "$QA_HOME/.pi/agent"
# Load the bridge from THIS checkout, not from whatever the developer has
# installed globally — otherwise the arm silently tests another build.
printf '{"packages":["%s"]}' "$EXT_DIR" > "$QA_HOME/.pi/agent/settings.json"

HOME="$QA_HOME" pi-dashboard start --port "$PORT" --pi-port "$GATEWAY" --no-tunnel \
  > "$QA_HOME/start.log" 2>&1 &

WAITED=0
while [ "$WAITED" -lt 90 ]; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ] && break
  sleep 2; WAITED=$((WAITED + 2))
done
if [ "$WAITED" -ge 90 ]; then
  echo "FAIL: the dashboard never started"
  sed -n '1,40p' "$QA_HOME/start.log"
  exit 1
fi

curl -s --max-time 5 "http://localhost:$PORT/api/health" -o "$QA_HOME/health.json"
SRV_PID="$(node -e "process.stdout.write(String(require('$QA_HOME/health.json').pid??''))")"
TRUE_ID="$(node -e "process.stdout.write(String(require('$QA_HOME/health.json').instanceId??''))")"
if [ -z "$TRUE_ID" ]; then
  echo "FAIL: /api/health published no instanceId — there is no identity to verify against"
  exit 1
fi
echo "  the live instance identifies as $TRUE_ID"

RECORD="$QA_HOME/.pi/dashboard/server.lock.meta.json"
if [ ! -f "$RECORD" ]; then
  echo "FAIL: no rendezvous record at $RECORD"
  exit 1
fi

run_pi() {
  # `--mode rpc` starts a session, which is where the bridge resolves its
  # endpoint and runs the verification. 20 s is well past both.
  ( cd "$QA_HOME" && HOME="$QA_HOME" \
      env -u PI_DASHBOARD_URL -u PI_DASHBOARD_SOCKET -u PI_DASHBOARD_TOKEN \
      timeout 20 "$PI_BIN" --mode rpc > "$QA_HOME/$1.out" 2> "$QA_HOME/$1.err" ) || true
}

# ── control: the record tells the truth ─────────────────────────────────────
run_pi control
if ! grep -aq "source=rendezvous-record" "$QA_HOME/control.err"; then
  echo "FAIL: the bridge did not resolve through the rendezvous record, so this arm"
  echo "      never exercised the path it claims to test"
  grep -a "dashboard\]" "$QA_HOME/control.err" | head -5
  exit 1
fi
if grep -aq "instance verification refused" "$QA_HOME/control.err"; then
  echo "FAIL: an untruthful refusal — the record named the live instance and was rejected anyway"
  grep -a "instance verification" "$QA_HOME/control.err" | head -3
  exit 1
fi
echo "  control: a truthful record is accepted, no refusal"

# ── mismatch: the record names somebody else ────────────────────────────────
RECORD="$RECORD" FAKE_ID="$FAKE_ID" node -e "
  const fs = require('fs');
  const p = process.env.RECORD;
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  r.identity = process.env.FAKE_ID;   // ports untouched: the endpoint stays reachable
  fs.writeFileSync(p, JSON.stringify(r, null, 2));
"
run_pi mismatch

if ! grep -aq "instance verification refused" "$QA_HOME/mismatch.err"; then
  echo "FAIL: the record named $FAKE_ID, the endpoint answered as $TRUE_ID, and the bridge adopted it anyway"
  echo "      (a same-HOME impostor passes the socket mode and the local token — identity is the ONLY discriminator)"
  grep -a "dashboard\]" "$QA_HOME/mismatch.err" | head -6
  exit 1
fi

# Both ids must appear. "Verification failed" without naming what was expected
# and what answered leaves an operator with nothing to act on (task 10.2).
REFUSAL="$(grep -a "instance verification refused" "$QA_HOME/mismatch.err" | head -1)"
case "$REFUSAL" in
  *"$FAKE_ID"*) ;;
  *) echo "FAIL: the refusal does not name the EXPECTED id: $REFUSAL"; exit 1 ;;
esac
case "$REFUSAL" in
  *"$TRUE_ID"*) ;;
  *) echo "FAIL: the refusal does not name the id that ANSWERED: $REFUSAL"; exit 1 ;;
esac
case "$REFUSAL" in
  *disconnecting*) ;;
  *) echo "FAIL: a conflict was detected but the connection was kept: $REFUSAL"; exit 1 ;;
esac
echo "  mismatch: refused, both ids named, connection torn down"

# And it must NOT quietly land somewhere else. Substituting a discovered
# dashboard for the one that failed verification is the original bug wearing a
# different hat.
if grep -a "dashboard\] endpoint" "$QA_HOME/mismatch.err" | grep -qv "source=rendezvous-record"; then
  echo "FAIL: after refusing, the bridge adopted a substitute endpoint"
  grep -a "dashboard\] endpoint" "$QA_HOME/mismatch.err" | head -4
  exit 1
fi
echo "  mismatch: no fallback to a discovered substitute"

echo "PASS: identity decides, not the per-HOME credential"
