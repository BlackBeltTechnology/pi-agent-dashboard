#!/usr/bin/env bash
set -eu

case "$1" in
  start)
    cwd=$2
    [[ $cwd =~ ^/fixtures/replay-cold-[0-9a-f-]+$ ]]
    mkdir -p "$cwd"
    setsid env PI_DASHBOARD_URL="ws://localhost:$PI_GATEWAY_PORT" bash -c \
      'echo $$ > "$1/pid"; cd "$1"; tail -f /dev/null | pi --mode rpc --model faux/faux-1' \
      bash "$cwd" > "$cwd/log" 2>&1 &
    ;;
  signal)
    signal=$2
    pid=$3
    [[ $signal == STOP || $signal == CONT ]]
    [[ $pid =~ ^[0-9]+$ && $pid -gt 1 ]]
    kill "-$signal" "$pid"
    ;;
  state)
    pid=$2
    [[ $pid =~ ^[0-9]+$ && $pid -gt 1 ]]
    awk '/^State:/ {print $2}' "/proc/$pid/status"
    ;;
  cleanup)
    cwd=$2
    [[ $cwd =~ ^/fixtures/replay-cold-[0-9a-f-]+$ ]]
    if [[ -s $cwd/pid ]]; then
      pid=$(cat "$cwd/pid")
      [[ $pid =~ ^[0-9]+$ && $pid -gt 1 ]]
      kill -CONT -- "-$pid" 2>/dev/null || :
      kill -- "-$pid" 2>/dev/null || :
    fi
    rm -rf -- "$cwd"
    ;;
  *) exit 2 ;;
esac
