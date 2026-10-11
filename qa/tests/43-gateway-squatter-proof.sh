#!/usr/bin/env bash
# Test: a dashboard-spawned session refuses a PORT SQUATTER and recovers.
#
# X7 (test-plan loopback-credential-proof). The loopback fallback listener
# (a deep $HOME makes the unix socket unrepresentable, as in 23-) is the exposure:
# a process that binds `127.0.0.1:<piPort>` after the dashboard exits used to
# harvest the raw `X-Pi-Local-Token` and receive the bridge. Now:
#   1. the spawned (MARKED) session dials the squatter, sends only an
#      `X-Pi-Local-Proof` (never `X-Pi-Local-Token`), and aborts before
#      registering — the squatter sees NO session_register frame;
#   2. `~/.pi/dashboard/local/bridge-identity.log` gets a `server-proof-missing`
#      line (owner-only, the one record the suspect server cannot suppress);
#   3. when the squatter leaves and the dashboard returns, the session
#      re-registers within the 300 s quarantine cap, and its `bridge_diagnostic`
#      reaches server.log over the VERIFIED connection.
#
# Skips off POSIX or without `pi` / `pi-dashboard`. Isolated HOME + ports; it
# never touches the operator's own dashboard.
# See change: loopback-credential-proof (task 8.1).
set -euo pipefail

echo "=== Test: gateway squatter proof (X7) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

for bin in pi pi-dashboard node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "SKIP: $bin not on PATH"; exit 0; }
done
case "$(uname -s)" in
  Darwin|Linux) ;;
  *) echo "SKIP: POSIX-only (Windows has no unix-socket fallback path to squat)"; exit 0 ;;
esac

PORT=18843
GATEWAY=19843
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/qa-squatter-XXXXXX")"
SEG="$(printf 'd%.0s' $(seq 1 40))"
DEEP_HOME="$ROOT/$SEG/$SEG"     # too deep for sun_path -> forced loopback fallback
mkdir -p "$DEEP_HOME"
CWD="$ROOT/work"; mkdir -p "$CWD"
LOGGER_LOG="$ROOT/squatter.jsonl"
SRV_PID=""; LOGGER_PID=""

cleanup() {
  [ -n "$LOGGER_PID" ] && kill -9 "$LOGGER_PID" 2>/dev/null || true
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null || true
  HOME="$DEEP_HOME" pi-dashboard stop --port "$PORT" >/dev/null 2>&1 || true
  rm -rf "$ROOT" 2>/dev/null || true
}
trap cleanup EXIT

health() { curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null || true; }
[ "$(health)" = "200" ] && { echo "FAIL: something already serves :$PORT"; exit 1; }

start_dashboard() {
  HOME="$DEEP_HOME" pi-dashboard start --port "$PORT" --pi-port "$GATEWAY" --no-tunnel > "$ROOT/start.log" 2>&1 &
  local waited=0
  while [ "$waited" -lt 90 ]; do [ "$(health)" = "200" ] && return 0; sleep 2; waited=$((waited + 2)); done
  echo "FAIL: dashboard did not start"; sed -n '1,40p' "$ROOT/start.log"; exit 1
}

start_dashboard
SRV_PID="$(curl -s "http://localhost:$PORT/api/health" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s).pid||'')))")"

# Spawn a headless session (marked: loopback literal + REQUIRE_SERVER_PROOF).
curl -sf -X POST "http://localhost:$PORT/api/session/spawn" -H 'content-type: application/json' \
  -d "{\"cwd\":\"$CWD\"}" >/dev/null || { echo "FAIL: spawn request failed"; exit 1; }
sessions() { curl -s "http://localhost:$PORT/api/sessions" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const a=(JSON.parse(s).data||[]).filter(x=>x.status&&x.status!=='ended');process.stdout.write(String(a.length))}catch{process.stdout.write('0')}})"; }
for _ in $(seq 1 45); do [ "$(sessions)" -ge 1 ] && break; sleep 2; done
[ "$(sessions)" -ge 1 ] || { echo "FAIL: spawned session never registered"; exit 1; }
echo "  spawned session registered against the genuine dashboard"

# Stop the dashboard (the keeper keeps the session alive), then squat its gateway port.
kill -9 "$SRV_PID" 2>/dev/null || true; SRV_PID=""
sleep 2
node -e '
const net = require("node:net");
const fs = require("node:fs");
const log = process.argv[1];
net.createServer((c) => {
  let buf = Buffer.alloc(0);
  c.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    const text = buf.toString("latin1");
    if (text.includes("\r\n\r\n") && !c.answered) {
      c.answered = true;
      const key = /sec-websocket-key: *([^\r\n]+)/i.exec(text);
      const accept = require("node:crypto").createHash("sha1").update((key ? key[1].trim() : "") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      // A squatter that completes the upgrade WITHOUT any server counter-proof.
      c.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
      fs.appendFileSync(log, JSON.stringify({ headers: text.split("\r\n\r\n")[0].toLowerCase() }) + "\n");
    } else if (c.answered) {
      fs.appendFileSync(log, JSON.stringify({ frameBytes: d.length, text: d.toString("latin1") }) + "\n");
    }
  });
  c.on("error", () => {});
}).listen(Number(process.argv[2]), "127.0.0.1");
' "$LOGGER_LOG" "$GATEWAY" &
LOGGER_PID=$!

# The session's reconnect (1 s backoff) reaches the squatter.
for _ in $(seq 1 30); do grep -q headers "$LOGGER_LOG" 2>/dev/null && break; sleep 1; done
grep -q headers "$LOGGER_LOG" 2>/dev/null || { echo "FAIL: the session never dialled the squatter"; exit 1; }
sleep 3
grep -q "x-pi-local-proof:" "$LOGGER_LOG" || { echo "FAIL: the squatter did not see an X-Pi-Local-Proof header"; exit 1; }
if grep -q "x-pi-local-token" "$LOGGER_LOG"; then echo "FAIL: the raw X-Pi-Local-Token reached the squatter"; exit 1; fi
if grep -q "frameBytes" "$LOGGER_LOG"; then echo "FAIL: the squatter received a frame (session_register leaked)"; cat "$LOGGER_LOG"; exit 1; fi
echo "  squatter saw only a proof and no frame"

IDLOG="$DEEP_HOME/.pi/dashboard/local/bridge-identity.log"
for _ in $(seq 1 10); do [ -f "$IDLOG" ] && break; sleep 1; done
grep -q '"cause":"server-proof-missing"' "$IDLOG" || { echo "FAIL: no server-proof-missing line in $IDLOG"; exit 1; }
echo "  bridge-identity.log records server-proof-missing"

# The squatter leaves; the genuine dashboard returns; the session recovers within the 300 s cap.
kill -9 "$LOGGER_PID" 2>/dev/null || true; LOGGER_PID=""
sleep 1
start_dashboard
for _ in $(seq 1 160); do [ "$(sessions)" -ge 1 ] && break; sleep 2; done
[ "$(sessions)" -ge 1 ] || { echo "FAIL: the session did not re-register within 320 s"; exit 1; }
echo "  session re-registered after the genuine dashboard returned"

LOG="$DEEP_HOME/.pi/dashboard/server.log"
for _ in $(seq 1 15); do grep -q "server_proof_failed" "$LOG" 2>/dev/null && break; sleep 2; done
grep -q "server_proof_failed" "$LOG" || { echo "FAIL: the bridge_diagnostic did not reach server.log over the verified connection"; exit 1; }

echo "PASS: marked session refused the squatter, logged it off-channel, and recovered"
