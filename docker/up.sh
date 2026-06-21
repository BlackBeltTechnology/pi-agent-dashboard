#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Workspace launcher — one list drives mounts AND first-run pins.
#
#   PI_WORKSPACES="/abs/a:/abs/b" ./up.sh [extra docker compose args...]
#
# Reads PI_WORKSPACES (path-separator list of host dirs), generates one
# path-identical read-write bind per entry (host /x -> container /x), and
# passes the same list as PI_DASHBOARD_PIN_DIRS so each mounted dir is
# auto-pinned on first run. See openspec change docker-packaging, Decision 6.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# Split PI_WORKSPACES on the OS path separator (':' on POSIX).
IFS=':' read -r -a WS <<< "${PI_WORKSPACES:-}"

mounts=()
pins=()
for dir in "${WS[@]}"; do
  [ -z "${dir}" ] && continue
  if [ ! -d "${dir}" ]; then
    echo "skip (not a dir): ${dir}" >&2
    continue
  fi
  abs="$(cd "${dir}" && pwd -P)"   # resolve to absolute, real path
  mounts+=("-v" "${abs}:${abs}")   # PATH-IDENTICAL, read-write
  pins+=("${abs}")                 # only validated, resolved dirs get pinned
  echo "mount: ${abs}" >&2
done

# First-run pin seeding uses the SAME validated+resolved list as the mounts —
# never the raw PI_WORKSPACES (which may include skipped non-directories).
PI_DASHBOARD_PIN_DIRS="$(IFS=':'; echo "${pins[*]:-}")"
export PI_DASHBOARD_PIN_DIRS

# `run --service-ports` applies the published ports plus our extra binds.
exec docker compose run --rm --service-ports \
  -e PI_DASHBOARD_PIN_DIRS \
  "${mounts[@]}" \
  "$@" \
  pi-dashboard
