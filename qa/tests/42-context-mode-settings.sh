#!/usr/bin/env bash
# Test: context-mode env scrub + settings projection on real dashboard spawns.
#
# Covers test-plan X8 (contaminated server → headless pi lacks bridge-internal
# vars), X9 (contaminated tmux server → pane pi lacks DEPTH), X10 (stale
# bridge-projected value does not survive a file change), X11 (no split
# SessionDB with storage.dataDir) and X12 (operator export wins, headless +
# tmux). See change: add-context-mode-settings-plugin.
#
# Needs `ps eww` (procps / BSD ps) to read a process environment, so it skips on
# Windows (no .ps1 twin: the scenarios are POSIX-process-env assertions).
# X8's MCP-child half, X10's bridge arm and X11 only run when the `context-mode`
# pi extension is installed; otherwise they SKIP with a note.
# Env: DASHBOARD_PORT (default 8000). Traps restore config + settings file.
set -euo pipefail

if ! command -v pi >/dev/null 2>&1; then echo "SKIP: pi not on PATH"; exit 0; fi
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) echo "SKIP: POSIX process-env assertions"; exit 0;; esac

echo "=== Test: context-mode settings + env scrub ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PORT="${DASHBOARD_PORT:-8000}"
CONFIG="$HOME/.pi/dashboard/config.json"
SETTINGS="$HOME/.pi/context-mode/settings.json"
BK_CONFIG=$(mktemp); BK_SETTINGS=$(mktemp)
HAD_CONFIG=0; HAD_SETTINGS=0
[ -f "$CONFIG" ] && { cp "$CONFIG" "$BK_CONFIG"; HAD_CONFIG=1; }
[ -f "$SETTINGS" ] && { cp "$SETTINGS" "$BK_SETTINGS"; HAD_SETTINGS=1; }
HAS_TMUX=0; command -v tmux >/dev/null 2>&1 && HAS_TMUX=1
HAS_CM=0; [ -d "$HOME/.pi/agent/npm/node_modules/context-mode" ] && HAS_CM=1
HAS_LSOF=0; command -v lsof >/dev/null 2>&1 && HAS_LSOF=1

cleanup() {
  pi-dashboard stop 2>/dev/null || true
  if [ "$HAD_CONFIG" = "1" ]; then cp "$BK_CONFIG" "$CONFIG"; else rm -f "$CONFIG"; fi
  if [ "$HAD_SETTINGS" = "1" ]; then cp "$BK_SETTINGS" "$SETTINGS"; else rm -f "$SETTINGS"; fi
  rm -f "$BK_CONFIG" "$BK_SETTINGS"
  [ "$HAS_TMUX" = "1" ] && tmux kill-session -t qa-cm-holder 2>/dev/null || true
}
trap cleanup EXIT

fail() { echo "FAIL: $1"; exit 1; }

# (re)start the dashboard server with extra env, wait for health.
start_server() {
  pi-dashboard stop 2>/dev/null || true
  sleep 1
  env "$@" pi-dashboard start &
  local i=0
  while [ $i -lt 30 ]; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/api/health 2>/dev/null || echo 000)" = "200" ] && return 0
    sleep 1; i=$((i + 1))
  done
  fail "server did not become healthy"
}

set_strategy() { # $1 = headless|tmux
  mkdir -p "$(dirname "$CONFIG")"
  STRAT="$1" CONFIG="$CONFIG" node -e '
    const fs=require("fs");let c={};try{c=JSON.parse(fs.readFileSync(process.env.CONFIG,"utf8"))}catch{}
    c.spawnStrategy=process.env.STRAT;fs.writeFileSync(process.env.CONFIG,JSON.stringify(c,null,2));'
}

# Spawn through REST, print the new session's pi pid (first /ws session_added for the cwd).
spawn_pid() {
  cd "$REPO_ROOT"
  PORT="$PORT" node -e '
    const WebSocket=require("ws"),fs=require("fs"),os=require("os"),path=require("path");
    const cwd=fs.mkdtempSync(path.join(os.tmpdir(),"qa-cm-"));
    const real=(p)=>{try{return fs.realpathSync(p)}catch{return p}};
    const pre=new Set();let armed=false;
    const ws=new WebSocket(`ws://localhost:${process.env.PORT}/ws`);
    const t=setTimeout(()=>{console.error("timeout");process.exit(2)},60000);
    ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());
      if(m.type!=="session_added"||!m.session)return;
      if(!armed){pre.add(m.session.id);return}
      if(pre.has(m.session.id)||real(m.session.cwd||"")!==real(cwd))return;
      if(!m.session.pid)return;
      console.log(m.session.pid);clearTimeout(t);process.exit(0)});
    ws.on("open",()=>setTimeout(async()=>{armed=true;
      await fetch(`http://localhost:${process.env.PORT}/api/session/spawn`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({cwd})})},500));'
}

proc_env() { ps eww -p "$1" 2>/dev/null | tr ' ' '\n'; }
has_var() { proc_env "$1" | grep -q "^$2="; }
var_val() { proc_env "$1" | grep "^$2=" | head -1 | cut -d= -f2-; }

# X8 — contaminated server, headless
set_strategy headless
start_server CONTEXT_MODE_BRIDGE_DEPTH=1 CONTEXT_MODE_BRIDGE_IDLE_MS=0
PID=$(spawn_pid) || fail "X8: headless spawn never registered"
has_var "$PID" CONTEXT_MODE_BRIDGE_DEPTH && fail "X8: pi inherited CONTEXT_MODE_BRIDGE_DEPTH"
has_var "$PID" CONTEXT_MODE_BRIDGE_IDLE_MS && fail "X8: pi inherited CONTEXT_MODE_BRIDGE_IDLE_MS"
echo "  ok X8: headless pi carries neither bridge-internal variable"
if [ "$HAS_CM" = "1" ]; then
  sleep 5
  pgrep -P "$PID" -f server.bundle.mjs >/dev/null 2>&1 || pgrep -f server.bundle.mjs >/dev/null 2>&1 \
    || fail "X8: context-mode MCP child (server.bundle.mjs) is not running"
  echo "  ok X8: context-mode MCP child running"
else
  echo "  skip X8 child check: context-mode not installed"
fi

# X9 — contaminated tmux server global env
if [ "$HAS_TMUX" = "1" ]; then
  tmux kill-server 2>/dev/null || true
  tmux new-session -d -s qa-cm-holder "sleep 300"
  tmux set-environment -g CONTEXT_MODE_BRIDGE_DEPTH 1
  set_strategy tmux
  start_server
  PID=$(spawn_pid) || fail "X9: tmux spawn never registered"
  has_var "$PID" CONTEXT_MODE_BRIDGE_DEPTH && fail "X9: pane pi inherited CONTEXT_MODE_BRIDGE_DEPTH from the tmux server"
  echo "  ok X9: tmux pane pi lacks CONTEXT_MODE_BRIDGE_DEPTH"
  tmux kill-server 2>/dev/null || true
else
  echo "  skip X9: tmux not installed"
fi

# X10 — stale bridge-projected value must not survive a file change (headless)
set_strategy headless
mkdir -p "$(dirname "$SETTINGS")"
echo '{"fetch.strict": true}' > "$SETTINGS"
# Server inherits what a bridge-auto-started server would: the projected value + marker.
start_server CTX_FETCH_STRICT=1 PI_CONTEXT_MODE_SETTINGS_PROJECTED=CTX_FETCH_STRICT
echo '{"fetch.strict": false}' > "$SETTINGS"
PID=$(spawn_pid) || fail "X10: spawn never registered"
has_var "$PID" CTX_FETCH_STRICT && fail "X10: stale CTX_FETCH_STRICT survived the file change"
has_var "$PID" PI_CONTEXT_MODE_SETTINGS_PROJECTED && fail "X10: provenance marker leaked into the spawned pi"
echo "  ok X10: stale projected value and marker removed"

# X11 — no split SessionDB under storage.dataDir
if [ "$HAS_CM" = "1" ] && [ "$HAS_LSOF" = "1" ]; then
  DATA=$(mktemp -d /tmp/cm-x.XXXX)
  echo "{\"storage.dataDir\": \"$DATA\"}" > "$SETTINGS"
  start_server
  PID=$(spawn_pid) || fail "X11: spawn never registered"
  sleep 8
  PIDS="$PID $(pgrep -P "$PID" | tr '\n' ' ')"
  lsof -p "$(echo $PIDS | tr ' ' ',')" 2>/dev/null | grep -q "$DATA" \
    || fail "X11: neither pi nor its MCP child opened a store under $DATA"
  echo "  ok X11: stores opened under the configured data directory"
else
  echo "  skip X11: needs the context-mode extension and lsof"
fi

# X12 — operator export wins over the file (headless + tmux)
echo '{"locale.timeZone": "Europe/Budapest"}' > "$SETTINGS"
set_strategy headless
start_server CONTEXT_MODE_TZ=UTC
PID=$(spawn_pid) || fail "X12: headless spawn never registered"
[ "$(var_val "$PID" CONTEXT_MODE_TZ)" = "UTC" ] || fail "X12: headless pi lost the exported CONTEXT_MODE_TZ=UTC"
if [ "$HAS_TMUX" = "1" ]; then
  set_strategy tmux
  start_server CONTEXT_MODE_TZ=UTC
  PID=$(spawn_pid) || fail "X12: tmux spawn never registered"
  [ "$(var_val "$PID" CONTEXT_MODE_TZ)" = "UTC" ] || fail "X12: tmux pi lost the exported CONTEXT_MODE_TZ=UTC"
fi
echo "  ok X12: operator export survives in headless${HAS_TMUX:+ and tmux} spawns"

echo "PASS: context-mode settings + env scrub"
