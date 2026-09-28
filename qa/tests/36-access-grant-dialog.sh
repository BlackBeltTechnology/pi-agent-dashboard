#!/usr/bin/env bash
# L2 smoke: access-grant prompts against a REAL server process and a REAL
# volume (change: add-access-grant-dialog, tasks 10.55-10.59).
#
# Why these live here and not at L1: the unit suites inject the kill switch,
# the YOLO env and the case-folding answer. Only a real process proves the env
# vars are read at boot, and only a real volume proves what realpath and the
# case probe answer on it.
#
# What it proves (test-plan #X12, #X11, #E18, #E19):
#   X12  PI_DASHBOARD_DISABLE_GRANT_PROMPT=1: a capability-holding socket gets
#        NO grant_request, the denial is still recorded (suppressedBy
#        "disabled"), the request is answered at once (never held)
#   X11  PI_DASHBOARD_GRANT_YOLO=<root>, no browser connected: a non-browser
#        request under the root stays denied; nothing is auto-allowed
#   E18  ~/.SSH on a case-insensitive volume is the forbidden ~/.ssh: never
#        promptable, never a YOLO root. On a case-sensitive volume it is a
#        distinct, ordinary directory.
#   E19  (macOS) a case-SENSITIVE APFS volume on a case-insensitive host:
#        `Proj` and `proj` are distinct subjects, containment does not fold
#
# Isolation: every boot uses a temp HOME and a non-8000 port, so the operator's
# own dashboard is never stopped or shadowed. Override the launcher with
# PI_DASHBOARD_CMD (e.g. `node packages/server/bin/pi-dashboard.mjs` from a
# checkout) and the port with QA_PORT.
#
# See change: add-access-grant-dialog.
set -euo pipefail

echo "=== Test: access-grant prompts (kill switch, env YOLO, case folding) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

PORT="${QA_PORT:-18321}"
PI_PORT="${QA_PI_PORT:-19321}"
BASE="http://localhost:${PORT}"
read -r -a DASH <<<"${PI_DASHBOARD_CMD:-pi-dashboard}"

# The dashboard tree (for `ws` / `jiti` / the access modules), from the launcher.
if [ -n "${PI_DASHBOARD_ROOT:-}" ]; then
  ROOT="$PI_DASHBOARD_ROOT"
elif [ "${DASH[0]}" = "node" ]; then
  ROOT="$(cd "$(dirname "${DASH[1]}")/../../.." && pwd)"
else
  ROOT="$(cd "$(dirname "$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$(command -v pi-dashboard)")")/../../.." && pwd)"
fi
SERVER_PKG="$ROOT/packages/server/package.json"
[ -f "$SERVER_PKG" ] || { echo "FAIL: cannot locate the dashboard tree (tried $ROOT)"; exit 1; }

WORKDIR="$(mktemp -d)"
QA_HOME="$WORKDIR/home"
CS_MOUNT=""
fail() { echo "FAIL: $*" >&2; exit 1; }
stop_dash() { HOME="$QA_HOME" "${DASH[@]}" stop >/dev/null 2>&1 || true; }
cleanup() {
  stop_dash
  if [ -n "$CS_MOUNT" ]; then hdiutil detach "$CS_MOUNT" -force >/dev/null 2>&1 || true; fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# `jq` is not guaranteed on every QA image; node always is.
jnode() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{process.exit(2)}process.stdout.write(String($1))})"; }
prompts() { curl -fsS "$BASE/api/access/prompts"; }

# boot <config-json> [ENV=VALUE ...]
boot() {
  local cfg="$1"
  shift
  stop_dash
  sleep 1
  rm -rf "$QA_HOME"
  mkdir -p "$QA_HOME/.pi/dashboard" "$QA_HOME/.ssh"
  printf '%s' "$cfg" >"$QA_HOME/.pi/dashboard/config.json"
  env HOME="$QA_HOME" "$@" "${DASH[@]}" start --port "$PORT" --pi-port "$PI_PORT" --no-tunnel >"$WORKDIR/start.log" 2>&1 &
  local waited=0
  while [ $waited -lt 40 ]; do
    curl -fsS "$BASE/api/health" >/dev/null 2>&1 && return 0
    sleep 1
    waited=$((waited + 1))
  done
  cat "$WORKDIR/start.log" >&2
  fail "server did not become healthy on :$PORT"
}

ENFORCE='{"hostGate":{"mode":"enforce"},"accessGrants":{"promptEnabled":true}}'

# ---------------------------------------------------------------- X12
echo "--- X12: kill switch ---"
boot "$ENFORCE" PI_DASHBOARD_DISABLE_GRANT_PROMPT=1
KILLED=$(prompts | jnode 'j.data.prompting.killSwitch && j.data.prompting.blockers.includes("kill-switch")')
[ "$KILLED" = "true" ] || fail "X12: kill switch not reported on /api/access/prompts"

X12_DIR="$WORKDIR/x12-unknown"
mkdir -p "$X12_DIR"
X12=$(node -e '
const { createRequire } = require("node:module");
const req = createRequire(process.argv[1]);
const WebSocket = req("ws");
const [base, dir] = process.argv.slice(2);
const ws = new WebSocket(base.replace("http", "ws") + "/ws", { headers: { origin: base } });
let requests = 0, capability = null;
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === "grant_channel") capability = m.capability;
  if (m.type === "grant_request") requests++;
});
const done = (v) => { console.log(v); ws.close(); process.exit(0); };
setTimeout(async () => {
  if (!capability) return done("no-capability");
  const t0 = Date.now();
  const r = await fetch(base + "/api/file/exists?cwd=" + encodeURIComponent(dir) + "&path=a", {
    headers: { "x-pi-grant-channel": capability },
  });
  const ms = Date.now() - t0;
  setTimeout(() => done(`${r.status}:${requests}:${ms < 5000 ? "fast" : "held"}`), 1500);
}, 1500);
setTimeout(() => done("timeout"), 20000);
' "$SERVER_PKG" "$BASE" "$X12_DIR")
[ "$X12" = "403:0:fast" ] || fail "X12: expected an immediate 403 and no grant_request, got '$X12'"
SUPPRESSED=$(prompts | jnode "(j.data.pending.find(p=>p.plane==='cwd')||{}).suppressedBy")
[ "$SUPPRESSED" = "disabled" ] || fail "X12: denial should be recorded as suppressed by 'disabled', got '$SUPPRESSED'"
echo "PASS: X12"

# ---------------------------------------------------------------- X11
echo "--- X11: env YOLO, no browser ---"
YOLO_ROOT="$WORKDIR/yolo-root"
mkdir -p "$YOLO_ROOT/inside"
YOLO_ROOT_REAL="$(cd "$YOLO_ROOT" && pwd -P)"
boot "$ENFORCE" PI_DASHBOARD_GRANT_YOLO="$YOLO_ROOT_REAL"
ACTIVE=$(prompts | jnode 'j.data.yolo.session && j.data.yolo.session.source')
[ "$ACTIVE" = "env" ] || fail "X11: env YOLO session not active (got '$ACTIVE')"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/file/exists?cwd=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$YOLO_ROOT_REAL/inside")&path=a")
[ "$CODE" = "403" ] || fail "X11: a non-browser request under the YOLO root must stay denied, got $CODE"
AUTO=$(prompts | jnode 'j.data.verdicts.filter(v=>v.answeredBy==="yolo").length')
[ "$AUTO" = "0" ] || fail "X11: YOLO answered a request with no capability ($AUTO auto-answers)"
echo "PASS: X11"

# ---------------------------------------------------------------- E18
echo "--- E18: ~/.SSH vs the forbidden ~/.ssh ---"
# Same boot: $QA_HOME/.ssh exists. Does this volume fold case?
if [ -d "$QA_HOME/.SSH" ]; then FOLDS=1; else FOLDS=0; mkdir -p "$QA_HOME/.SSH"; fi
SSH_UPPER=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$QA_HOME/.SSH")
curl -s -o /dev/null "$BASE/api/file/exists?cwd=$SSH_UPPER&path=a"
PENDING=$(prompts | jnode "j.data.pending.filter(p=>p.plane==='cwd' && p.subject.toLowerCase().endsWith('/.ssh')).length")
ROOTS=$(curl -fsS "$BASE/api/access/yolo/roots?base=$SSH_UPPER" | jnode 'j.data.roots.length')
# Positive controls on the same boot: an ordinary unknown dir IS recorded and
# IS offered as a YOLO root, so the zero counts below mean "refused".
mkdir -p "$WORKDIR/ordinary"
ORD=$(node -e 'console.log(encodeURIComponent(require("fs").realpathSync(process.argv[1])))' "$WORKDIR/ordinary")
curl -s -o /dev/null "$BASE/api/file/exists?cwd=$ORD&path=a"
ORD_PENDING=$(prompts | jnode "j.data.pending.filter(p=>p.plane==='cwd' && p.subject.endsWith('/ordinary')).length")
ORD_ROOTS=$(curl -fsS "$BASE/api/access/yolo/roots?base=$ORD" | jnode 'j.data.roots.length')
[ "$ORD_PENDING" = "1" ] && [ "$ORD_ROOTS" != "0" ] || fail "E18 control: an ordinary dir was not recorded/offered (pending=$ORD_PENDING roots=$ORD_ROOTS)"
if [ "$FOLDS" = 1 ]; then
  [ "$PENDING" = "0" ] || fail "E18: ~/.SSH on a case-insensitive volume became promptable"
  [ "$ROOTS" = "0" ] || fail "E18: ~/.SSH offered as a YOLO root on a case-insensitive volume"
  echo "PASS: E18 (case-insensitive volume: refused)"
else
  [ "$PENDING" = "1" ] || fail "E18: ~/.SSH is a distinct directory on a case-sensitive volume, expected a pending entry"
  echo "PASS: E18 (case-sensitive volume: distinct, ordinary)"
fi
stop_dash

# ---------------------------------------------------------------- E19
if [ "$(uname -s)" = "Darwin" ] && command -v hdiutil >/dev/null 2>&1; then
  echo "--- E19: case-sensitive APFS volume on a case-insensitive host ---"
  hdiutil create -size 20m -fs "Case-sensitive APFS" -volname "pi-qa-cs-$$" "$WORKDIR/cs.dmg" >/dev/null
  CS_MOUNT="$(hdiutil attach "$WORKDIR/cs.dmg" -nobrowse | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)"
  [ -d "$CS_MOUNT" ] || fail "E19: could not mount the case-sensitive image"
  mkdir -p "$CS_MOUNT/Proj/a" "$CS_MOUNT/proj"
  HOST_DIR="$WORKDIR/host-ci"
  mkdir -p "$HOST_DIR/Proj/a"
  E19=$(node -e '
const { createRequire } = require("node:module");
const req = createRequire(process.argv[1]);
const { createJiti } = req("jiti");
const jiti = createJiti(process.argv[1]);
(async () => {
  const m = await jiti.import(process.argv[2]);
  const [cs, host] = process.argv.slice(3);
  // canonicalSubject returns { canonical, ... } | null; compare .canonical.
  const opt = (p) => ({ caseInsensitive: m.volumeCaseInsensitive(p) });
  const canon = (p) => m.canonicalSubject(p, opt(p))?.canonical ?? null;
  const csUpper = canon(cs + "/Proj");
  const csLower = canon(cs + "/proj");
  const out = {
    csFolds: opt(cs + "/Proj").caseInsensitive,
    csResolved: csUpper !== null && csLower !== null,
    csDistinct: csUpper !== csLower,
    csNotWithin: !m.isSubjectWithin(cs + "/Proj/a", cs + "/proj", opt(cs + "/Proj")),
    csWithinControl: m.isSubjectWithin(cs + "/Proj/a", cs + "/Proj", opt(cs + "/Proj")),
    hostFolds: opt(host + "/Proj").caseInsensitive,
    hostSame: m.isSameSubject(host + "/Proj", host + "/PROJ", opt(host + "/Proj")),
  };
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
' "$SERVER_PKG" "$ROOT/packages/server/src/access/canonical-subject.ts" "$CS_MOUNT" "$HOST_DIR")
  echo "  $E19"
  [ "$(printf '%s' "$E19" | jnode 'j.csFolds')" = "false" ] || fail "E19: the case-sensitive volume was read as folding"
  [ "$(printf '%s' "$E19" | jnode 'j.csResolved && j.csWithinControl')" = "true" ] || fail "E19: control failed (subjects unresolved or containment broken)"
  [ "$(printf '%s' "$E19" | jnode 'j.csDistinct && j.csNotWithin')" = "true" ] || fail "E19: Proj and proj folded together"
  if [ "$(printf '%s' "$E19" | jnode 'j.hostFolds')" = "true" ]; then
    [ "$(printf '%s' "$E19" | jnode 'j.hostSame')" = "true" ] || fail "E19: the case-insensitive host volume did not fold Proj/PROJ"
  fi
  echo "PASS: E19 (host volume folds: $(printf '%s' "$E19" | jnode 'j.hostFolds'))"
else
  echo "SKIP: E19 needs macOS hdiutil for a case-sensitive volume on a case-insensitive host"
fi

echo "=== access-grant prompts: all checks passed ==="
