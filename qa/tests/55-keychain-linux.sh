#!/usr/bin/env bash
# L2 (Linux): the credential data key against the REAL @napi-rs/keyring binding.
#
#   E91  Secret Service round trip. A private session bus (dbus-run-session) with an
#        UNLOCKED gnome-keyring, no key file, a plaintext vault: start the server ->
#        the keychain entry `pi-dashboard-credential-key` / `data-key-v1` exists
#        (`secret-tool lookup`, in this test shell only), the vault is migrated to an
#        envelope, and after a restart it still decodes (a vault account is still listed).
#        NOTE the Linux attribute is `username`, not `account` (CI spike C6).
#   X13  No session bus (`env -u DBUS_SESSION_BUS_ADDRESS -u XDG_RUNTIME_DIR`): health 200 within 15 s, the
#        startup log carries `state=unavailable reason=keychain_unavailable`, NO
#        `pi-dashboard-credential-key` entry lands in the kernel keyrings (`keyctl show @s`/
#        `@u`; CI spike C2: the binding's default store would silently use keyutils), the
#        vault is still plaintext and readable, and a write is refused.
#
# SKIPs (exit 0) off Linux or without dbus-run-session / gnome-keyring-daemon / secret-tool.
# Isolation: a temp HOME and non-8000 ports; the operator's dashboard is never touched.
# Override the launcher with PI_DASHBOARD_CMD (e.g. `node packages/server/bin/pi-dashboard.mjs`).
#
# See change: encrypt-credentials-at-rest (test-plan E91, X13; spike secret-service.sh).
set -euo pipefail

echo "=== Test: Linux keychain (Secret Service) data key ==="

[ "$(uname -s)" = "Linux" ] || { echo "SKIP: not Linux"; exit 0; }
for tool in dbus-run-session gnome-keyring-daemon secret-tool; do
  command -v "$tool" >/dev/null 2>&1 || { echo "SKIP: $tool not on PATH (apt install dbus-x11 gnome-keyring libsecret-tools)"; exit 0; }
done

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

PORT="${QA_PORT:-18331}"
PI_PORT="${QA_PI_PORT:-19331}"
BASE="http://localhost:${PORT}"
read -r -a DASH <<<"${PI_DASHBOARD_CMD:-pi-dashboard}"
WORKDIR="$(mktemp -d)"
QA_HOME="$WORKDIR/home"
VAULT="$QA_HOME/.pi/dashboard/vault.json"
SERVICE="pi-dashboard-credential-key"

fail() { echo "FAIL: $*" >&2; exit 1; }
stop_dash() { env HOME="$QA_HOME" "${DASH[@]}" stop >/dev/null 2>&1 || true; }
cleanup() { stop_dash; rm -rf "$WORKDIR"; }
trap cleanup EXIT

wait_health() {
  local waited=0
  while [ "$waited" -lt "${1:-40}" ]; do
    curl -fsS "$BASE/api/health" >/dev/null 2>&1 && return 0
    sleep 1; waited=$((waited + 1))
  done
  return 1
}

# A plaintext vault with one account whose value is a marker we can grep for.
seed_plain_vault() {
  rm -rf "$QA_HOME"; mkdir -p "$QA_HOME/.pi/dashboard"
  printf '%s' '{"accounts":[{"id":"qa1","provider":"gemini","kind":"key","namespace":"user","label":"qa-label","value":"qa-plain-value-0001"}]}' >"$VAULT"
  chmod 600 "$VAULT"
}

# The vault API through the CLI (mints local proof). Prints the account labels, one per line.
vault_labels() {
  env HOME="$QA_HOME" "${DASH[@]}" api GET /api/vault --port "$PORT" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);((v.data||v).accounts||[]).forEach(a=>console.log(a.label))})'
}

# ── E91 ───────────────────────────────────────────────────────────────────
echo "--- E91: unlocked gnome-keyring on a private session bus"
seed_plain_vault
# Everything that needs the bus runs inside ONE dbus-run-session so the server and secret-tool share it.
cat >"$WORKDIR/e91-inner.sh" <<'INNER'
set -euo pipefail
read -r -a DASH <<<"$QA_DASH_CMD"
base="http://localhost:$QA_PORT"
up() { for _ in $(seq 1 40); do curl -fsS "$base/api/health" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }
printf qa | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1
env HOME="$QA_HOME" "${DASH[@]}" start --port "$QA_PORT" --pi-port "$QA_PI_PORT" --no-tunnel >"$QA_WORKDIR/start.log" 2>&1 &
up || { echo "E91-FAIL health"; exit 1; }
sleep 2
# The entry exists (its value is NOT printed: only the length is tested).
secret-tool lookup service "$QA_SERVICE" username data-key-v1 | wc -c | awk '{ exit ($1 >= 32) ? 0 : 1 }' || { echo "E91-FAIL no keychain entry"; exit 1; }
head -1 "$QA_HOME/.pi/dashboard/vault.json" | grep -qx "pi-dashboard-encrypted:v1" || { echo "E91-FAIL vault not migrated"; exit 1; }
if grep -q qa-plain-value-0001 "$QA_HOME/.pi/dashboard/vault.json"; then echo "E91-FAIL plaintext marker still readable"; exit 1; fi
env HOME="$QA_HOME" "${DASH[@]}" stop >/dev/null 2>&1 || true
sleep 2
env HOME="$QA_HOME" "${DASH[@]}" start --port "$QA_PORT" --pi-port "$QA_PI_PORT" --no-tunnel >"$QA_WORKDIR/start2.log" 2>&1 &
up || { echo "E91-FAIL health after restart"; exit 1; }
env HOME="$QA_HOME" "${DASH[@]}" api GET /api/vault --port "$QA_PORT" 2>/dev/null | grep -q qa-label || { echo "E91-FAIL vault does not decode after restart"; exit 1; }
env HOME="$QA_HOME" "${DASH[@]}" stop >/dev/null 2>&1 || true
echo "E91-OK"
INNER
QA_DASH_CMD="${DASH[*]}" QA_HOME="$QA_HOME" QA_PORT="$PORT" QA_PI_PORT="$PI_PORT" QA_WORKDIR="$WORKDIR" QA_SERVICE="$SERVICE" \
  dbus-run-session -- bash "$WORKDIR/e91-inner.sh" >"$WORKDIR/e91.log" 2>&1 || true
grep -q '^E91-OK$' "$WORKDIR/e91.log" || { cat "$WORKDIR/e91.log"; echo "--- start.log"; tail -20 "$WORKDIR/start.log" 2>/dev/null; fail "E91 did not pass"; }
grep -q 'source=keychain state=ready' "$WORKDIR/start.log" 2>/dev/null || grep -q 'source=keychain state=ready' "$QA_HOME/.pi/dashboard/server.log" 2>/dev/null \
  || fail "E91: the startup log never reported source=keychain state=ready"
echo "    keychain entry created, vault migrated, decodes after a restart"
stop_dash

# ── X13 ───────────────────────────────────────────────────────────────────
echo "--- X13: no session bus, real binding"
seed_plain_vault
PLAIN_BEFORE="$(sha256sum "$VAULT" | cut -d' ' -f1)"
env -u DBUS_SESSION_BUS_ADDRESS -u XDG_RUNTIME_DIR HOME="$QA_HOME" "${DASH[@]}" start --port "$PORT" --pi-port "$PI_PORT" --no-tunnel >"$WORKDIR/start-x13.log" 2>&1 &
wait_health 15 || { tail -20 "$WORKDIR/start-x13.log"; fail "X13: health did not answer 200 within 15 s"; }
sleep 2
LOG="$QA_HOME/.pi/dashboard/server.log"
grep -h 'credential-key' "$LOG" "$WORKDIR/start-x13.log" 2>/dev/null | grep -q 'state=unavailable reason=keychain_unavailable' \
  || { grep -h 'credential-key' "$LOG" "$WORKDIR/start-x13.log" 2>/dev/null | head; fail "X13: no 'state=unavailable reason=keychain_unavailable' line"; }
if command -v keyctl >/dev/null 2>&1; then
  for ring in @s @u; do
    keyctl show "$ring" 2>/dev/null | grep -q "$SERVICE" && fail "X13: a $SERVICE entry landed in the kernel keyring $ring (keyutils fallback)"
  done
else
  echo "    note: keyctl not installed; kernel-keyring check skipped"
fi
[ "$(sha256sum "$VAULT" | cut -d' ' -f1)" = "$PLAIN_BEFORE" ] || fail "X13: the vault file changed (it must stay plaintext and untouched)"
vault_labels | grep -qx qa-label || fail "X13: the plaintext vault is no longer readable"
if env HOME="$QA_HOME" "${DASH[@]}" api POST /api/vault/accounts --port "$PORT" --data '{"provider":"qa","label":"x13","value":"qa-write-value-0002"}' >"$WORKDIR/x13-write.log" 2>&1; then
  fail "X13: a write was accepted with no key source"
fi
grep -q 'PI_DASHBOARD_DATA_KEY_FILE' "$WORKDIR/x13-write.log" || fail "X13: the refusal does not name PI_DASHBOARD_DATA_KEY_FILE"
echo "    unavailable, no keyutils entry, vault plaintext and readable, write refused"

echo "PASS: Linux Secret Service round trip and the no-bus refusal"
