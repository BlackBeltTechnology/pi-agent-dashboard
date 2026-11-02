#!/bin/sh
# ensure-dashboard.sh — make sure the local pi-dashboard is running; never start a second one.
#
#   sh ensure-dashboard.sh [--install | --check]
#
# stdout: exactly one STATUS=<value> line, plus BASE=<url> (and INSTALL=<kind>) when ready.
#   STATUS values: already-running started busy recovery port-conflict not-installed sandbox failed
# Everything else (including every launcher's own output) goes to stderr.
# Exit: 0 ready, 1 failed, 2 sandbox, 3 busy/recovery, 4 not-installed, 5 port-conflict.
#
#   --install  consent to a one-time global install of the latest release (never implied).
#   --check    verify-only: classify the resolved port, never lock, never launch.
#
# Safe to re-run: a run killed by a tool timeout is repeated and reports already-running.
# Design: openspec change add-claude-code-plugin (D2-D5). POSIX sh + curl; no Node needed.
#
# Test-only timing overrides are honoured only when PIDB_TEST=1:
#   PIDB_TEST_REFUSAL_S PIDB_TEST_RECORD_POLL_S PIDB_TEST_LIVE_POLL_S
#   PIDB_TEST_READY_S PIDB_TEST_LOCK_WAIT_S PIDB_TEST_NO_SYSTEM_DIRS

# --- Node range the server accepts (pinned to package.json engines.node and the shared
# --- isUsableNodeVersion gate by scripts/__tests__/claude-plugin-ensure-dashboard.test.mjs).
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=19
NODE_CAP_MAJOR=27
NODE_AFFECTED_24_FROM=1
NODE_AFFECTED_24_TO=2

PKG="@blackbelt-technology/pi-agent-dashboard@latest"
APP_BUNDLE_ID="com.blackbelt-technology.pi-dashboard"

# A caller-exported override must never reach a server we start (design D4).
unset npm_config_allow_remote

: "${HOME:?HOME must be set}"
D="${HOME:?}/.pi/dashboard"
META="$D/server.lock.meta.json"
SPIDF="$D/server.pid"
CONFIG="$D/config.json"
SERVER_LOG="$D/server.log"

INSTALL_OK=0
CHECK=0
for a in "$@"; do
  case "$a" in
    --install) INSTALL_OK=1 ;;
    --check) CHECK=1 ;;
  esac
done

# Windows (all in seconds)
REFUSAL_S=10
RECORD_POLL_S=10
LIVE_POLL_S=60
READY_S=60
LOCK_WAIT_S=170
NO_SYSTEM_DIRS=0
if [ "${PIDB_TEST:-}" = 1 ]; then
  is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; }
  [ -n "${PIDB_TEST_REFUSAL_S:-}" ] && is_num "$PIDB_TEST_REFUSAL_S" && REFUSAL_S=$PIDB_TEST_REFUSAL_S
  [ -n "${PIDB_TEST_RECORD_POLL_S:-}" ] && is_num "$PIDB_TEST_RECORD_POLL_S" && RECORD_POLL_S=$PIDB_TEST_RECORD_POLL_S
  [ -n "${PIDB_TEST_LIVE_POLL_S:-}" ] && is_num "$PIDB_TEST_LIVE_POLL_S" && LIVE_POLL_S=$PIDB_TEST_LIVE_POLL_S
  [ -n "${PIDB_TEST_READY_S:-}" ] && is_num "$PIDB_TEST_READY_S" && READY_S=$PIDB_TEST_READY_S
  [ -n "${PIDB_TEST_LOCK_WAIT_S:-}" ] && is_num "$PIDB_TEST_LOCK_WAIT_S" && LOCK_WAIT_S=$PIDB_TEST_LOCK_WAIT_S
  [ "${PIDB_TEST_NO_SYSTEM_DIRS:-}" = 1 ] && NO_SYSTEM_DIRS=1
fi

log() { printf '%s\n' "$*" >&2; }

HAVE_LOCK=0
L=""
release_lock() {
  if [ "$HAVE_LOCK" = 1 ]; then
    rm -f "$L/holder"
    rmdir "$L" 2>/dev/null
    HAVE_LOCK=0
  fi
}
trap release_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---- terminal outcomes --------------------------------------------------------------

ready() { # <already-running|started> [install-kind]
  printf 'STATUS=%s\n' "$1"
  printf 'BASE=%s\n' "$BASE"
  [ -n "${2:-}" ] && printf 'INSTALL=%s\n' "$2"
  exit 0
}
die() { # <status> <exit> <message>
  printf 'STATUS=%s\n' "$1"
  log "$3"
  exit "$2"
}

# ---- sandbox refusal (before any probe, lock or launch) -----------------------------

if [ -n "${CLAUDE_CODE_IS_COWORK:-}" ] || [ -n "${CLAUDE_CODE_REMOTE:-}" ]; then
  die sandbox 2 "This Claude session does not run on your computer (Cowork / web sandbox), so it cannot start or reach pi-dashboard. Use Claude Code on your own machine."
fi
case "${CLAUDE_CONFIG_DIR:-}" in
  /sessions/*)
    die sandbox 2 "This Claude session does not run on your computer (Cowork sandbox), so it cannot start or reach pi-dashboard. Use Claude Code on your own machine."
    ;;
esac

# ---- port resolution (PI_DASHBOARD_PORT > DASHBOARD_PORT > config.json top-level port > 8000)

usable_port() { # plain decimal integer 1..65535
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "${#1}" -le 5 ] || return 1
  n=$(expr "$1" + 0)
  [ "$n" -ge 1 ] && [ "$n" -le 65535 ]
}

# Top-level "port" of config.json (depth 1 only: a nested {"x":{"port":9}} is ignored).
config_port() {
  [ -r "$CONFIG" ] || return 0
  awk '
    BEGIN { RS = "\001" }
    {
      s = $0; n = length(s); depth = 0; instr = 0; buf = ""
      for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (instr) {
          if (c == "\\") { i++; buf = buf "?"; continue }
          if (c == "\"") {
            instr = 0
            j = i + 1
            while (j <= n && substr(s, j, 1) ~ /[ \t\r\n]/) j++
            if (substr(s, j, 1) == ":" && depth == 1 && buf == "port") {
              j++
              while (j <= n && substr(s, j, 1) ~ /[ \t\r\n]/) j++
              v = ""
              while (j <= n && substr(s, j, 1) ~ /[0-9]/) { v = v substr(s, j, 1); j++ }
              nx = substr(s, j, 1)
              if (v != "" && nx !~ /[.eE0-9]/) print v
              exit
            }
            buf = ""
            continue
          }
          buf = buf c
          continue
        }
        if (c == "\"") { instr = 1; buf = ""; continue }
        if (c == "{" || c == "[") depth++
        else if (c == "}" || c == "]") depth--
      }
    }' "$CONFIG" 2>/dev/null
}

PORT=""
PORT_SRC=""
if usable_port "${PI_DASHBOARD_PORT:-}"; then
  PORT=$(expr "$PI_DASHBOARD_PORT" + 0); PORT_SRC=env
elif usable_port "${DASHBOARD_PORT:-}"; then
  PORT=$(expr "$DASHBOARD_PORT" + 0); PORT_SRC=env
else
  cp=$(config_port)
  if usable_port "$cp"; then
    PORT=$(expr "$cp" + 0); PORT_SRC=config
  else
    PORT=8000; PORT_SRC=default
  fi
fi
BASE="http://localhost:$PORT"

# ---- instance records ----------------------------------------------------------------

alive() { # live pid?
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$1" 2>/dev/null
}

META_STATE=absent; META_PID=""; META_PORT=""
SPID_STATE=absent; SPID=""
read_records() {
  META_STATE=absent; META_PID=""; META_PORT=""
  SPID_STATE=absent; SPID=""
  if [ -e "$META" ]; then
    c=$(cat "$META" 2>/dev/null)
    p=$(printf '%s' "$c" | grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9][0-9]*' | head -n1 | grep -o '[0-9]*$')
    hp=$(printf '%s' "$c" | grep -o '"httpPort"[[:space:]]*:[[:space:]]*[0-9][0-9]*' | head -n1 | grep -o '[0-9]*$')
    last=$(printf '%s' "$c" | tr -d ' \t\r\n' | tail -c 1)
    if [ -n "$p" ] && [ -n "$hp" ] && [ "$last" = "}" ]; then
      META_STATE=valid; META_PID=$p; META_PORT=$hp
    else
      META_STATE=unknown
    fi
  fi
  if [ -e "$SPIDF" ]; then
    sp=$(head -n1 "$SPIDF" 2>/dev/null | tr -d ' \t\r\n')
    case "$sp" in
      ''|*[!0-9]*) SPID_STATE=unknown ;;
      *) SPID_STATE=valid; SPID=$sp ;;
    esac
  fi
}

# A server is starting, restarting or stuck: a live recorded pid, or a record we cannot read.
records_blocking() {
  [ "$META_STATE" = unknown ] && return 0
  [ "$SPID_STATE" = unknown ] && return 0
  [ "$META_STATE" = valid ] && alive "$META_PID" && return 0
  [ "$SPID_STATE" = valid ] && alive "$SPID" && return 0
  return 1
}

pid_matches() { # health pid == lock metadata pid (server.pid only when metadata is absent)
  read_records
  if [ "$META_STATE" = valid ]; then
    [ "$1" = "$META_PID" ]
  elif [ "$META_STATE" = absent ] && [ "$SPID_STATE" = valid ]; then
    [ "$1" = "$SPID" ]
  else
    return 1
  fi
}

# ---- health classification ------------------------------------------------------------
# CLASS: refused busy recovery conflict verified

CLASS=""
probe_pid=""
classify() {
  out=$(curl -s -m 5 -w '\n%{http_code}' "http://localhost:$1/api/health" 2>/dev/null)
  rc=$?
  code=$(printf '%s' "$out" | tail -n1)
  body=$(printf '%s' "$out" | sed '$d')
  probe_pid=""
  if [ "$rc" -eq 7 ]; then CLASS=refused; return; fi
  if [ "$rc" -ne 0 ]; then CLASS=busy; return; fi
  if printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*false' &&
     printf '%s' "$body" | grep -Eq '"mode"[[:space:]]*:[[:space:]]*"recovery"'; then
    CLASS=recovery; return
  fi
  if [ "$code" = 200 ] && printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
    probe_pid=$(printf '%s' "$body" | grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9][0-9]*' | head -n1 | grep -o '[0-9]*$')
    if [ -n "$probe_pid" ]; then CLASS=okbody; else CLASS=conflict; fi
    return
  fi
  CLASS=conflict
}

# classify + resolve an ok-shaped body against the records (they race the probe: poll briefly)
settle() {
  classify "$1"
  [ "$CLASS" = okbody ] || return 0
  j=0
  while :; do
    if pid_matches "$probe_pid"; then CLASS=verified; return; fi
    [ "$j" -ge "$RECORD_POLL_S" ] && break
    sleep 1
    j=$((j + 1))
  done
  CLASS=conflict
}

report() { # exits for every class except refused
  case "$CLASS" in
    verified) ready already-running ;;
    recovery) die recovery 3 "pi-dashboard on port $PORT is in recovery mode. Do not start another instance; open $BASE or check $SERVER_LOG." ;;
    conflict) die port-conflict 5 "Port $PORT answers but is not a verified pi-dashboard of this HOME. Free the port or set DASHBOARD_PORT. No credentials were sent." ;;
    busy) die busy 3 "Something holds port $PORT but /api/health does not answer; the dashboard may still be starting or is overloaded. Not starting another one. Retry in a minute; if it persists check $SERVER_LOG." ;;
  esac
}

# Poll until a verified dashboard answers (soft: refused/busy keep waiting). Returns on timeout.
wait_verified() { # <seconds> [step]
  w=0
  step=${2:-1}
  while :; do
    settle "$PORT"
    case "$CLASS" in
      verified|recovery|conflict) report ;;
    esac
    [ "$w" -ge "$1" ] && return 1
    sleep "$step"
    w=$((w + step))
  done
}

# ---- verify-only mode -------------------------------------------------------------------

if [ "$CHECK" = 1 ]; then
  settle "$PORT"
  case "$CLASS" in
    refused) die failed 1 "pi-dashboard is not running on port $PORT." ;;
    *) report ;;
  esac
  exit 1
fi

# ---- start path ---------------------------------------------------------------------------

settle "$PORT"
[ "$CLASS" = refused ] || report

live_wait() { # a server is recorded alive/unknown: wait for it, never launch
  read_records
  if [ "$META_STATE" = valid ] && alive "$META_PID" && [ "$META_PORT" != "$PORT" ]; then
    if [ "$PORT_SRC" = env ]; then
      die failed 1 "A pi-dashboard of this HOME is already running on port $META_PORT, but port $PORT was requested through the environment. Use port $META_PORT or stop that instance."
    fi
    PORT=$META_PORT
    BASE="http://localhost:$PORT"
  fi
  wait_verified "$LIVE_POLL_S" || true
  die busy 3 "A pi-dashboard process is recorded but no verified dashboard answered within ${LIVE_POLL_S}s; it may still be starting. Retry in a minute; if it persists check $SERVER_LOG."
}

# --- lock ---------------------------------------------------------------------------------

lock_stale() {
  hp=""
  [ -f "$L/holder" ] && hp=$(head -n1 "$L/holder" 2>/dev/null | tr -d ' \t\r\n')
  if [ -n "$hp" ]; then
    alive "$hp" || return 0
  else
    # No holder, or one the owner is still writing (the redirect creates it empty first): judge by age.
    [ -n "$(find "$L" -maxdepth 0 -mmin +1 2>/dev/null)" ] && return 0
  fi
  [ -n "$(find "$L" -maxdepth 0 -mmin +11 2>/dev/null)" ] && return 0
  return 1
}

acquire_lock() {
  mkdir -p "$D" || die failed 1 "Cannot create $D."
  L="$D/claude-bootstrap-$PORT.lock"
  waited=0
  while :; do
    if mkdir "$L" 2>/dev/null; then
      HAVE_LOCK=1
      printf '%s\n' "$$" > "$L/holder"
      return 0
    fi
    if lock_stale; then
      rm -f "$L/holder"
      rmdir "$L" 2>/dev/null
      continue
    fi
    # Another bootstrap holds it: wait for the dashboard it is starting.
    settle "$PORT"
    case "$CLASS" in verified|recovery|conflict) report ;; esac
    if [ "$waited" -ge "$LOCK_WAIT_S" ]; then
      die busy 3 "Another bootstrap is running (lock $L) and no dashboard came up within ${LOCK_WAIT_S}s. Retry in a minute."
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

# --- launch sources ---------------------------------------------------------------------

is_abs_exec() { case "$1" in /*) [ -x "$1" ] ;; *) return 1 ;; esac; }

# Highest-versioned nvm Node that has the tool.
nvm_tool() {
  for nd in "${HOME:?}"/.nvm/versions/node/v*; do
    [ -x "$nd/bin/$1" ] || continue
    printf '%s\t%s\n' "${nd##*/v}" "$nd/bin/$1"
  done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n1 | cut -f2
}

# find_tool <name> -> prints an absolute path or nothing.
# PATH, known install dirs, then a non-interactive login shell (never -i: SIGTSTP).
find_tool() {
  t=$1
  p=$(command -v "$t" 2>/dev/null)
  if is_abs_exec "$p"; then printf '%s\n' "$p"; return 0; fi
  if [ "$t" != npm ]; then
    np=$(command -v npm 2>/dev/null)
    if is_abs_exec "$np"; then
      pre=$("$np" prefix -g 2>/dev/null)
      for c in "$pre/bin/$t" "$pre/$t"; do
        if [ -n "$pre" ] && is_abs_exec "$c"; then printf '%s\n' "$c"; return 0; fi
      done
    fi
  fi
  c=$(nvm_tool "$t")
  if is_abs_exec "$c"; then printf '%s\n' "$c"; return 0; fi
  for c in "${HOME:?}/.volta/bin/$t"; do
    if is_abs_exec "$c"; then printf '%s\n' "$c"; return 0; fi
  done
  if [ "$NO_SYSTEM_DIRS" != 1 ]; then
    for c in "/opt/homebrew/bin/$t" "/usr/local/bin/$t"; do
      if is_abs_exec "$c"; then printf '%s\n' "$c"; return 0; fi
    done
  fi
  found=""
  out=$("${SHELL:-/bin/zsh}" -lc "command -v $t" 2>/dev/null)
  while IFS= read -r line; do
    case "$line" in
      /*/"$t") is_abs_exec "$line" && found=$line ;;
    esac
  done <<EOF
$out
EOF
  if [ -n "$found" ]; then printf '%s\n' "$found"; return 0; fi
  return 1
}

# Newest npx-cache copy of the CLI that is not a prerelease (non-durable).
npx_cache_cli() {
  for c in $(ls -dt "${HOME:?}"/.npm/_npx/*/node_modules/.bin/pi-dashboard 2>/dev/null); do
    [ -x "$c" ] || continue
    pj="${c%/.bin/pi-dashboard}/@blackbelt-technology/pi-agent-dashboard/package.json"
    ver=$(grep -m1 '"version"' "$pj" 2>/dev/null | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    case "$ver" in *-*) continue ;; esac
    printf '%s\n' "$c"
    return 0
  done
  return 1
}

# ready_wait: like wait_verified, but a verified answer here means we STARTED it.
ready_wait() { # <install-kind>
  w=0
  while :; do
    settle "$PORT"
    case "$CLASS" in
      verified) ready started "$1" ;;
      recovery|conflict) report ;;
    esac
    [ "$w" -ge "$READY_S" ] && break
    sleep 1
    w=$((w + 1))
  done
  die failed 1 "The dashboard was launched but no verified dashboard answered on port $PORT within ${READY_S}s. See $SERVER_LOG. If this is the desktop app's first run, finish its setup wizard."
}

run_cli() { # <cli> <install-kind>
  log "Starting pi-dashboard on port $PORT with $1"
  if ! "$1" start --port "$PORT" 1>&2; then
    die failed 1 "'$1 start --port $PORT' failed. See $SERVER_LOG."
  fi
  ready_wait "$2"
}

node_usable() { # <vX.Y.Z>
  v=${1#v}
  case "$v" in [0-9]*.[0-9]*.[0-9]*) ;; *) return 1 ;; esac
  maj=${v%%.*}; rest=${v#*.}; min=${rest%%.*}
  case "$maj$min" in *[!0-9]*) return 1 ;; esac
  [ "$maj" -ge "$NODE_CAP_MAJOR" ] && return 1
  [ "$maj" -lt "$NODE_MIN_MAJOR" ] && return 1
  if [ "$maj" -eq "$NODE_MIN_MAJOR" ] && [ "$min" -lt "$NODE_MIN_MINOR" ]; then return 1; fi
  if [ "$maj" -eq 24 ] && [ "$min" -ge "$NODE_AFFECTED_24_FROM" ] && [ "$min" -le "$NODE_AFFECTED_24_TO" ]; then return 1; fi
  return 0
}

do_install() {
  NPM=$(find_tool npm)
  [ -n "$NPM" ] || die failed 1 "npm was not found, so nothing was downloaded. Install Node.js >= 22.19 (https://nodejs.org) and run this again."
  NODE=$(find_tool node)
  [ -n "$NODE" ] || die failed 1 "node was not found, so nothing was downloaded. Install Node.js >= 22.19 (https://nodejs.org) and run this again."
  nv=$("$NODE" --version 2>/dev/null)
  if ! node_usable "$nv"; then
    die failed 1 "Node ${nv:-unknown} is not usable by pi-dashboard. Need Node >=22.19.0 <27, excluding v24.1 and v24.2. Nothing was downloaded."
  fi

  log "Installing $PKG globally (about 1 GB, about a minute)..."
  if npm_config_allow_remote=all "$NPM" install -g "$PKG" 1>&2; then
    pre=$("$NPM" prefix -g 2>/dev/null)
    cli=$(command -v pi-dashboard 2>/dev/null)
    is_abs_exec "$cli" || cli=""
    if [ -z "$cli" ]; then
      for c in "$pre/bin/pi-dashboard" "$pre/pi-dashboard"; do
        if [ -n "$pre" ] && is_abs_exec "$c"; then cli=$c; break; fi
      done
    fi
    [ -n "$cli" ] || die failed 1 "The install finished but no pi-dashboard command was found under $pre."
    ver=""
    for pj in "$pre/lib/node_modules/@blackbelt-technology/pi-agent-dashboard/package.json" "$pre/node_modules/@blackbelt-technology/pi-agent-dashboard/package.json"; do
      if [ -r "$pj" ]; then
        ver=$(grep -m1 '"version"' "$pj" | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
        break
      fi
    done
    case "$ver" in
      '') die failed 1 "Could not read the installed pi-agent-dashboard version; not starting it." ;;
      *-*) die failed 1 "The installed version $ver is a prerelease (a mis-tagged 'latest'); not starting it." ;;
    esac
    run_cli "$cli" global
  fi

  log "The global install failed (no write access to the npm global prefix?)."
  log "Hint: configure a user-writable npm prefix, then re-run:"
  log "  npm config set prefix ~/.npm-global   and add ~/.npm-global/bin to PATH"
  log "Falling back to a download into the npm cache (non-durable)."
  if ! npm_config_allow_remote=all "$NPM" exec --yes --package="$PKG" -- node -e 0 1>&2; then
    die failed 1 "Could not fetch $PKG into the npm cache either."
  fi
  NPX=$(command -v npx 2>/dev/null)
  is_abs_exec "$NPX" || NPX="$(dirname "$NPM")/npx"
  [ -x "$NPX" ] || die failed 1 "npx was not found next to npm."
  log "Warning: this runtime lives in the npm cache (~/.npm/_npx), not a durable install; the pi bridge is registered there."
  if ! "$NPX" --yes "$PKG" start --port "$PORT" 1>&2; then
    die failed 1 "'npx --yes $PKG start --port $PORT' failed. See $SERVER_LOG."
  fi
  ready_wait npx-cache
}

launch() {
  CLI=$(find_tool pi-dashboard)
  if [ -n "$CLI" ]; then run_cli "$CLI" ""; fi

  CLI=$(npx_cache_cli)
  if [ -n "$CLI" ]; then
    log "Using an existing npx-cache copy of pi-dashboard (non-durable): $CLI"
    run_cli "$CLI" ""
  fi

  if [ "$PORT_SRC" != env ] && [ "$(uname 2>/dev/null)" = Darwin ] && command -v open >/dev/null 2>&1; then
    if open -g -b "$APP_BUNDLE_ID" 1>&2; then
      log "Opened the pi-dashboard desktop app in the background."
      ready_wait ""
    fi
  fi

  if [ "$INSTALL_OK" = 1 ]; then do_install; fi

  log "pi-dashboard is not installed on this machine. To install it (about 1 GB):"
  log "  npm install -g $PKG"
  log "or re-run this script with --install after the user agrees."
  die not-installed 4 "No pi-dashboard command or app was found."
}

# Refused: first look for a recorded process, then hold the refusal for the window.
i=0
while :; do
  read_records
  if records_blocking; then live_wait; fi
  [ "$i" -ge "$REFUSAL_S" ] && break
  sleep 1
  i=$((i + 1))
  settle "$PORT"
  [ "$CLASS" = refused ] || report
done

acquire_lock

# Re-check the start conditions now that we own the lock.
settle "$PORT"
[ "$CLASS" = refused ] || report
read_records
if records_blocking; then live_wait; fi

launch
