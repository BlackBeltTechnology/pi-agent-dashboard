#!/bin/sh
# watch-events.sh — follow the dashboard's agent event stream, one stdout line per event.
#
#   sh watch-events.sh BASE [--session ID[,ID...]] [--types T[,T...]] [--header-file FILE] [--once]
#
# Reads GET BASE/api/events/stream (Server-Sent Events) and prints:
#   PI-EVENT ready                       connected (again after every reconnect)
#   PI-EVENT <type> <json>               one event; <json> is a single line
#   PI-EVENT error <reason>              fatal; the script exits 1
# Types: session_added status session_removed question_opened question_closed.
# Open questions are re-sent after every (re)connect, so the same question_opened
# can appear twice. Heartbeats are swallowed.
#
#   --once         exit 0 after the first event (for a background call that wakes Claude once).
#   --header-file  curl header file holding `Authorization: Bearer <token>`; never echoed.
#
# Reconnects on a dropped or refused connection (up to 30 tries in a row, backing off to 10 s).
# An HTTP error (400 bad filter, 401/403 token needed) is fatal.
# Design: openspec change add-agent-event-stream. POSIX sh + curl; no Node, no jq.

BASE=""
SESSION=""
TYPES=""
HEADER_FILE=""
ONCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --types) TYPES="$2"; shift 2 ;;
    --header-file) HEADER_FILE="$2"; shift 2 ;;
    --once) ONCE=1; shift ;;
    -*) echo "PI-EVENT error unknown-option $1"; exit 1 ;;
    *) BASE="$1"; shift ;;
  esac
done
[ -n "$BASE" ] || { echo "PI-EVENT error missing-base"; exit 1; }
if [ -n "$HEADER_FILE" ] && [ ! -r "$HEADER_FILE" ]; then
  echo "PI-EVENT error header-file-unreadable"
  exit 1
fi

URL="${BASE%/}/api/events/stream"
SEP="?"
[ -n "$SESSION" ] && { URL="${URL}${SEP}session=${SESSION}"; SEP="&"; }
[ -n "$TYPES" ] && URL="${URL}${SEP}types=${TYPES}"

CR=$(printf '\r')

# Parse SSE from stdin. Returns 3 after the first event with --once, else 0 at EOF.
parse() {
  event=""
  data=""
  while IFS= read -r line; do
    line=${line%"$CR"}
    case "$line" in
      "event: "*) event="${line#event: }" ;;
      "data: "*) data="${line#data: }" ;;
      "")
        if [ "$event" = ready ]; then
          echo "PI-EVENT ready"
        elif [ -n "$event" ]; then
          echo "PI-EVENT $event $data"
          [ "$ONCE" = 1 ] && return 3
        fi
        event=""
        data=""
        ;;
    esac
  done
  return 0
}

# One connection. curl writes into a FIFO so it can be stopped the moment --once is
# satisfied (a pipeline would wait for the next heartbeat). Sets CODE = curl's exit status.
stream_once() {
  rm -f "$FIFO"
  mkfifo "$FIFO" || return 1
  if [ -n "$HEADER_FILE" ]; then
    curl -sSfN -H 'Accept: text/event-stream' -H "@$HEADER_FILE" "$URL" >"$FIFO" 2>/dev/null &
  else
    curl -sSfN -H 'Accept: text/event-stream' "$URL" >"$FIFO" 2>/dev/null &
  fi
  CURL_PID=$!
  parse <"$FIFO"
  parsed=$?
  [ "$parsed" = 3 ] && kill "$CURL_PID" 2>/dev/null
  wait "$CURL_PID"
  CODE=$?
  CURL_PID=""
  return "$parsed"
}

WORK=$(mktemp -d "${TMPDIR:-/tmp}/pi-watch.XXXXXX") || exit 1
FIFO="$WORK/stream"
CURL_PID=""
cleanup() {
  [ -n "$CURL_PID" ] && kill "$CURL_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 0' INT TERM

fails=0
while :; do
  stream_once
  [ $? = 3 ] && exit 0
  case "$CODE" in
    22) echo "PI-EVENT error http (400 = bad --session/--types, 401/403 = token needed)"; exit 1 ;;
    0 | 18 | 52 | 56) fails=0 ;; # server closed or connection dropped: reconnect at once
    *) fails=$((fails + 1)) ;;
  esac
  if [ "$fails" -ge 30 ]; then
    echo "PI-EVENT error unreachable $BASE"
    exit 1
  fi
  delay=$((fails < 10 ? fails + 1 : 10))
  [ "$fails" = 0 ] && delay=1
  sleep "$delay"
done
