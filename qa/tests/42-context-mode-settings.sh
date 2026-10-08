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
# X8's MCP-child half and X11 need a driven prompt (context-mode starts its
# stores/child on the first before_agent_start) and are SKIPPED here.
# Always self-isolates (throwaway HOME, port 18558, private tmux socket).
set -euo pipefail

if ! command -v pi >/dev/null 2>&1; then echo "SKIP: pi not on PATH"; exit 0; fi
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) echo "SKIP: POSIX process-env assertions"; exit 0;; esac

echo "=== Test: context-mode settings + env scrub ==="

# This script restarts dashboard servers and (X9) kills a tmux server, so it
# NEVER runs against the operator's real HOME / port 8000 / default tmux socket.
# Unless already isolated it re-executes itself with a throwaway HOME, its own
# dashboard port, a private TMUX_TMPDIR and a `pi-dashboard` shim.
if [ "${PI_QA_CM_ISOLATED:-}" != "1" ]; then
  _here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _repo="$(cd "$_here/../.." && pwd)"
  # Short /tmp path on purpose: a long $TMPDIR overflows the unix-socket path limit (gateway socket).
  ISO=$(mktemp -d /tmp/qa-cm.XXXXXX)
  mkdir -p "$ISO/home/.pi/dashboard" "$ISO/bin" "$ISO/tmux"
  echo '{"port":18558,"piPort":19558}' > "$ISO/home/.pi/dashboard/config.json"
  # Seed a minimal pi agent dir: the package tree is shared read-only by symlink and
  # the settings file is a fresh one (a copy of the operator's would load every
  # extension they use, with their credentials, into a throwaway HOME).
  mkdir -p "$ISO/home/.pi/agent"
  [ -d "$HOME/.pi/agent/npm" ] && ln -s "$HOME/.pi/agent/npm" "$ISO/home/.pi/agent/npm"
  echo '{"packages":[]}' > "$ISO/home/.pi/agent/settings.json"
  # The build under test: PI_QA_PI_DASHBOARD (e.g. `node <checkout>/packages/server/bin/pi-dashboard.mjs`)
  # when set, else the installed `pi-dashboard`, else this checkout. NOTE a stale global install
  # silently tests the OLD code (it then correctly FAILS X8) — pass the override when developing.
  REAL_PD="${PI_QA_PI_DASHBOARD:-$(command -v pi-dashboard || true)}"
  if [ -z "$REAL_PD" ]; then REAL_PD="node $_repo/packages/server/bin/pi-dashboard.mjs"; fi
  printf '#!/usr/bin/env bash\nexec %s "$@"\n' "$REAL_PD" > "$ISO/bin/pi-dashboard"
  chmod +x "$ISO/bin/pi-dashboard"
  set +e
  env HOME="$ISO/home" TMUX_TMPDIR="$ISO/tmux" DASHBOARD_PORT=18558 PI_QA_CM_ISOLATED=1 \
    PATH="$ISO/bin:$PATH" bash "${BASH_SOURCE[0]}"
  rc=$?
  # Reap anything the isolated run left behind (keepers/pi run under the isolated HOME).
  TMUX_TMPDIR="$ISO/tmux" tmux kill-server 2>/dev/null || true
  # Headless sessions (rpc keeper + pi) and servers outlive `pi-dashboard stop`: kill every
  # process whose ENVIRONMENT carries the throwaway HOME (never matches the operator's).
  python3 - "$ISO/home" <<'PY' 2>/dev/null || true
import ctypes, ctypes.util, os, signal, struct, sys
needle = ("HOME=" + sys.argv[1]).encode()
def env_blob(pid):
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            return f.read()
    except OSError:
        pass
    try:
        libc = ctypes.CDLL(ctypes.util.find_library("c"))
        mib = (ctypes.c_int * 3)(1, 49, pid)
        size = ctypes.c_size_t(0)
        if libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0:
            return b""
        buf = ctypes.create_string_buffer(size.value)
        libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0)
        return buf.raw[: size.value]
    except Exception:
        return b""
me = os.getpid()
import subprocess
for tok in subprocess.check_output(["ps", "-ax", "-o", "pid="]).split():
    pid = int(tok)
    if pid in (me, os.getppid()):
        continue
    blob = env_blob(pid)
    # argv comes first in PROCARGS2; require the needle as a whole NUL-delimited entry (env, not argv text).
    if needle in blob.split(b"\0") and b"python3" not in blob[:300]:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
PY
  rm -rf "$ISO"
  exit $rc
fi


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

SPAWNED=""
reap_sessions() { # pi + its rpc keeper (stopping the server does not end headless sessions)
  local p pp
  for p in $SPAWNED; do
    pp=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    if [ -n "$pp" ] && [ "$pp" -gt 1 ] && ps -o command= -p "$pp" 2>/dev/null | grep -q rpc-keeper; then kill -9 "$pp" 2>/dev/null || true; fi
    kill -9 "$p" 2>/dev/null || true
  done
}

cleanup() {
  reap_sessions
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

# Process environment, one NAME=value per line. `ps eww` is NOT reliable: pi
# rewrites its process title, which blanks the env block on macOS and would make
# every "variable absent" assertion pass vacuously. Linux: /proc; macOS: sysctl
# KERN_PROCARGS2. A process whose env cannot be read at all FAILS the test.
proc_env() {
  local pid="$1" out
  if [ -r "/proc/$pid/environ" ]; then
    out=$(tr '\0' '\n' < "/proc/$pid/environ")
  else
    out=$(python3 - "$pid" <<'PY' 2>/dev/null
import ctypes, ctypes.util, struct, sys
libc = ctypes.CDLL(ctypes.util.find_library("c"))
pid = int(sys.argv[1])
mib = (ctypes.c_int * 3)(1, 49, pid)
size = ctypes.c_size_t(0)
libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0)
buf = ctypes.create_string_buffer(size.value)
libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0)
for part in buf.raw[: size.value].split(b"\0"):
    s = part.decode(errors="ignore")
    if "=" in s and not s.startswith("/"):
        print(s)
PY
)
  fi
  # A readable env always has PATH or HOME; an empty read is a harness failure, not a pass.
  echo "$out" | grep -qE '^(PATH|HOME)=' || return 1
  echo "$out"
}
# An unreadable env FAILS the run (never a vacuous "absent").
read_env() { ENVTXT=$(proc_env "$1") || { echo "FAIL: cannot read the environment of pid $1"; exit 1; }; }
has_var() { read_env "$1"; echo "$ENVTXT" | grep -q "^$2="; }
var_val() { read_env "$1"; echo "$ENVTXT" | grep "^$2=" | head -1 | cut -d= -f2-; }

# X8 — contaminated server, headless
set_strategy headless
start_server CONTEXT_MODE_BRIDGE_DEPTH=1 CONTEXT_MODE_BRIDGE_IDLE_MS=0
PID=$(spawn_pid) || fail "X8: headless spawn never registered"
SPAWNED="$SPAWNED $PID"
has_var "$PID" CONTEXT_MODE_BRIDGE_DEPTH && fail "X8: pi inherited CONTEXT_MODE_BRIDGE_DEPTH"
has_var "$PID" CONTEXT_MODE_BRIDGE_IDLE_MS && fail "X8: pi inherited CONTEXT_MODE_BRIDGE_IDLE_MS"
echo "  ok X8: headless pi carries neither bridge-internal variable"
# The MCP child (server.bundle.mjs) is started lazily from context-mode's
# before_agent_start, i.e. only once a prompt is driven; an idle spawned session
# has no child to assert on. That half of X8 needs a driven prompt (see
# 10-faux-model.sh) and is SKIPPED here.
echo "  skip X8 MCP-child half: context-mode starts it on the first prompt (needs a driven prompt)"

# X9 — contaminated tmux server global env
if [ "$HAS_TMUX" = "1" ]; then
  tmux kill-server 2>/dev/null || true
  tmux new-session -d -s qa-cm-holder "sleep 300"
  tmux set-environment -g CONTEXT_MODE_BRIDGE_DEPTH 1
  set_strategy tmux
  start_server
  PID=$(spawn_pid) || fail "X9: tmux spawn never registered"
SPAWNED="$SPAWNED $PID"
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
SPAWNED="$SPAWNED $PID"
has_var "$PID" CTX_FETCH_STRICT && fail "X10: stale CTX_FETCH_STRICT survived the file change"
has_var "$PID" PI_CONTEXT_MODE_SETTINGS_PROJECTED && fail "X10: provenance marker leaked into the spawned pi"
echo "  ok X10: stale projected value and marker removed"

# X11 — no split SessionDB under storage.dataDir. Both stores open on the first
# prompt (before_agent_start), so this needs a driven prompt + the context-mode
# extension; SKIPPED here (covered by unit tests on the projection + spawn env,
# and by the live env assertions above).
echo "  skip X11: needs a driven ctx_* prompt (see 10-faux-model.sh)"

# X12 — operator export wins over the file (headless + tmux)
echo '{"locale.timeZone": "Europe/Budapest"}' > "$SETTINGS"
set_strategy headless
start_server CONTEXT_MODE_TZ=UTC
PID=$(spawn_pid) || fail "X12: headless spawn never registered"
SPAWNED="$SPAWNED $PID"
[ "$(var_val "$PID" CONTEXT_MODE_TZ)" = "UTC" ] || fail "X12: headless pi lost the exported CONTEXT_MODE_TZ=UTC"
if [ "$HAS_TMUX" = "1" ]; then
  set_strategy tmux
  start_server CONTEXT_MODE_TZ=UTC
  PID=$(spawn_pid) || fail "X12: tmux spawn never registered"
SPAWNED="$SPAWNED $PID"
  [ "$(var_val "$PID" CONTEXT_MODE_TZ)" = "UTC" ] || fail "X12: tmux pi lost the exported CONTEXT_MODE_TZ=UTC"
fi
echo "  ok X12: operator export survives in headless${HAS_TMUX:+ and tmux} spawns"

echo "PASS: context-mode settings + env scrub"
