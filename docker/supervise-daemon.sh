#!/usr/bin/env bash
# Keep PID 1 alive for a DETACHED dashboard daemon's lifetime.
#
# `pi-dashboard start` spawns the server detached and returns as soon as it
# polls healthy — correct on a workstation, fatal as a container's PID 1, which
# then exits 0 and takes the whole container down with it. `restart:
# unless-stopped` hides the shape: the container comes straight back, so it
# looks up at almost any instant while actually cycling every ~30s.
#
# The obvious alternative — run the server in the FOREGROUND as PID 1 — breaks
# `POST /api/restart`, the documented restart path: the server exits and returns
# under a NEW pid, which would kill PID 1 and the container with it. So the
# daemon stays detached and this supervises the pidfile instead, tolerating the
# gap where no pid is live.
#
# Sourced by both entrypoints so the production container and the test harness
# supervise identically — the divergence is what let the deployment ship broken
# while every E2E run stayed green.
#
# See change: add-pi-gateway-transport-identity.

# supervise_daemon <pidfile> [label]
#
# Blocks until the daemon is gone for RESTART_GRACE_TICKS consecutive ticks.
# Forwards TERM/INT to whoever owns the pidfile AT THE TIME OF THE SIGNAL, not
# the pid captured at boot — an in-place restart replaces it.
supervise_daemon() {
  pidfile="$1"
  label="${2:-dashboard daemon}"

  # WAIT for the pidfile rather than requiring it up front. `pi-dashboard
  # start` gives up polling at 30s and returns non-zero, but the daemon it
  # spawned is detached and still coming up — a cold jiti start routinely
  # exceeds that window. Bailing here cost the container one full restart
  # cycle on every cold boot.
  pidfile_wait="${PIDFILE_WAIT_TICKS:-60}"   # x2s
  server_pid=""
  while [ "${pidfile_wait}" -gt 0 ]; do
    server_pid="$(cat "${pidfile}" 2>/dev/null || true)"
    if [ -n "${server_pid}" ] && kill -0 "${server_pid}" 2>/dev/null; then
      break
    fi
    server_pid=""
    pidfile_wait=$((pidfile_wait - 1))
    sleep 2
  done
  if [ -z "${server_pid}" ]; then
    echo "[supervise] no live daemon behind ${pidfile} — nothing to supervise" >&2
    return 1
  fi

  trap 'kill -TERM "$(cat "'"${pidfile}"'" 2>/dev/null || echo "'"${server_pid}"'")" 2>/dev/null || true' TERM INT

  # x5s = up to 120s of downtime before we call it dead. Watching the BOOT pid
  # alone made `POST /api/restart` fatal: the old `kill -0` went false, PID 1
  # fell through, and the container died mid-restart.
  # See change: restore-ask-user-tool-state-on-reconnect.
  grace_ticks="${RESTART_GRACE_TICKS:-24}"
  missed=0
  while :; do
    cur="$(cat "${pidfile}" 2>/dev/null || true)"
    if [ -n "${cur}" ] && kill -0 "${cur}" 2>/dev/null; then
      if [ "${cur}" != "${server_pid}" ]; then
        echo "[supervise] ${label} restarted: pid ${server_pid} -> ${cur}"
        server_pid="${cur}"
      fi
      missed=0
    else
      missed=$((missed + 1))
      if [ "${missed}" -ge "${grace_ticks}" ]; then
        break
      fi
    fi
    sleep 5
  done
  echo "[supervise] ${label} (pid ${server_pid}) exited"
}
