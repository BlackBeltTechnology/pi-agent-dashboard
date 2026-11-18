#!/usr/bin/env bash
# Test: a dashboard spawn does NOT auto-trust a folder dashboard trust does not cover
# (harden-agent-tool-guards D3; test-plan #E72 clone/pinned, #E73 unpinned -> pinned -> unpinned).
#
# A clone with `.pi/extensions/x.ts` (writes a marker file when loaded) is spawned into through
# the REST spawn road (`pi-dashboard api POST /api/session/spawn`: the rule lives in the bridge, so
# every road - MCP, WS, automation - reaches the same decision; the L1 roads suite pins that).
#   1. unpinned, not in a workspace, no trust.json entry  -> marker ABSENT (extension not loaded)
#   2. pin the folder (ws `pin_directory`)                -> marker PRESENT (dashboard trust)
#   3. unpin it again                                      -> marker ABSENT (no stale trust)
# Needs pi on PATH and a reachable dashboard; SKIPs (exit 0) otherwise. The clone lives under $HOME
# (not a temp dir: temp folders are forbidden-folder and never mirrored).
# Env: DASHBOARD_PORT (default 8000), PI_QA_TRUST_WAIT (seconds to wait per leg, default 20).
set -euo pipefail

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH (spawn trust smoke requires pi installed)"
  exit 0
fi

echo "=== Test: dashboard spawn does not auto-trust an uncovered folder ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PORT="${DASHBOARD_PORT:-8000}"
WAIT="${PI_QA_TRUST_WAIT:-20}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "SKIP: dashboard not reachable on :$PORT"
  exit 0
fi

CLONE="$HOME/qa-spawn-trust-$$"
MARKER="$HOME/qa-spawn-trust-$$.marker"
mkdir -p "$CLONE/.pi/extensions"
cat > "$CLONE/.pi/extensions/x.ts" <<EXT
import * as fs from "node:fs";
export default function () { fs.writeFileSync("$MARKER", "loaded"); }
EXT
(cd "$CLONE" && git init -q . 2>/dev/null || true)

cleanup() {
  rm -rf "$CLONE" "$MARKER"
}
trap cleanup EXIT

cd "$REPO_ROOT"

# pin_directory / unpin_directory over the browser WebSocket (ticket minted with local proof).
ws_send() {
  PORT="$PORT" MSG="$1" node -e '
const WebSocket = require("ws");
const { execFileSync } = require("node:child_process");
const t = JSON.parse(execFileSync("pi-dashboard", ["api", "POST", "/api/ws-ticket", "--data", JSON.stringify({ scope: "browser" })], { encoding: "utf8" })).data.ticket;
const ws = new WebSocket("ws://localhost:" + process.env.PORT + "/ws?ticket=" + encodeURIComponent(t));
ws.on("open", () => { ws.send(process.env.MSG); setTimeout(() => { ws.close(); process.exit(0); }, 1500); });
ws.on("error", (e) => { console.error("ws error: " + e.message); process.exit(1); });
'
}

spawn_and_check() { # $1 = expected: present|absent ; $2 = label
  rm -f "$MARKER"
  pi-dashboard api POST /api/session/spawn --port "$PORT" --data "{\"cwd\":\"$CLONE\"}" >/dev/null
  local waited=0 seen=0
  while [ "$waited" -lt "$WAIT" ]; do
    if [ -f "$MARKER" ]; then seen=1; break; fi
    sleep 1
    waited=$((waited + 1))
  done
  if [ "$1" = "present" ] && [ "$seen" -ne 1 ]; then
    echo "FAIL: $2 - project extension was NOT loaded within ${WAIT}s (expected trusted)"
    exit 1
  fi
  if [ "$1" = "absent" ] && [ "$seen" -eq 1 ]; then
    echo "FAIL: $2 - project extension LOADED (dashboard spawn auto-trusted an uncovered folder)"
    exit 1
  fi
  echo "PASS: $2 ($1)"
}

spawn_and_check absent "unpinned clone"

ws_send "{\"type\":\"pin_directory\",\"path\":\"$CLONE\"}"
sleep 3 # the server writes the trust snapshot on pin
spawn_and_check present "clone after pin"

ws_send "{\"type\":\"unpin_directory\",\"path\":\"$CLONE\"}"
sleep 3
spawn_and_check absent "clone after unpin (no stale trust)"

echo "PASS: spawn trust follows dashboard trust (unpinned -> pinned -> unpinned)"
