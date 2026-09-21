# shellcheck shell=bash
# ---------------------------------------------------------------------------
# Pure port/project + harness-memory helpers for the parallel-worktree test
# harness. Sourced by test-up.sh and test-down.sh. No side effects on source.
# See change: parallelize-test-harness, docker/TESTING.md.
# See change: stabilize-browser-e2e (list_running_harness_projects, memory parse).
# ---------------------------------------------------------------------------

# Disjoint port windows (1000 ports each). Dashboard scan never bleeds into the
# gateway window and vice-versa (find_free_in_window wraps at the window edge).
# shellcheck disable=SC2034  # consumed by the sourcing script (test-up.sh)
DASH_LO=18000; DASH_HI=18999
# shellcheck disable=SC2034
GW_LO=19000;   GW_HI=19999

# Stable numeric hash of a string. POSIX cksum CRC -> identical on macOS+Linux.
derive_hash() { printf '%s' "$1" | cksum | cut -d' ' -f1; }

# Compose-legal project name. Pure function of the worktree path (NOT the
# chosen ports / state file) so teardown can always re-derive it from $PWD.
derive_project() { printf 'pi-dash-test-%s' "$(derive_hash "$1")"; }

# True (0) when nothing is listening on 127.0.0.1:$1. bash /dev/tcp connect
# check — no nc/lsof dependency (macOS + Linux).
is_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Echo first free port starting at $1, incrementing and wrapping $hi->$lo so
# every port in [$lo..$hi] is visited at most once (cap = window size = 1000).
# Returns 1 (+ stderr message) when the whole window is busy.
find_free_in_window() {
  local start="$1" lo="$2" hi="$3"
  local span=$(( hi - lo + 1 ))
  local p="$start" i=0
  while (( i < span )); do
    if is_free "$p"; then printf '%s' "$p"; return 0; fi
    p=$(( p + 1 )); (( p > hi )) && p="$lo"
    i=$(( i + 1 ))
  done
  echo "parallelize-test-harness: no free port in [$lo..$hi] (window of $span exhausted)" >&2
  return 1
}

# Echo the OTHER running `pi-dash-test-*` compose projects on this daemon, one
# per line, excluding $1 (the caller's own project). Empty + exit 0 when none
# (or when docker is unavailable) so a caller can test `[ -n ... ]` safely.
# Always exits 0 — a failed probe is "no information", never an error.
# See change: stabilize-browser-e2e (#451 part 2).
list_running_harness_projects() {
  local self="${1:-}"
  docker ps \
    --filter "label=com.docker.compose.project" \
    --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null \
    | grep '^pi-dash-test-' \
    | { if [ -n "$self" ]; then grep -v "^${self}\$"; else cat; fi; } \
    | sort -u \
    || true
}

# Parse a docker compose memory limit ("4g", "512m", "1gb", "2097152") into
# bytes. Echo nothing + return 1 when unparseable, so the caller can warn and
# proceed rather than refuse on a value it does not understand.
# See change: stabilize-browser-e2e (#451 part 2).
parse_memory_bytes() {
  local raw="${1:-}"
  [ -n "$raw" ] || return 1
  local num unit
  num="$(printf '%s' "$raw" | tr -cd '0-9')"
  unit="$(printf '%s' "$raw" | tr -d '0-9' | tr '[:upper:]' '[:lower:]')"
  [ -n "$num" ] || return 1
  case "$unit" in
    ""|b)  printf '%s' "$num" ;;
    k|kb)  printf '%s' $(( num * 1024 )) ;;
    m|mb)  printf '%s' $(( num * 1024 * 1024 )) ;;
    g|gb)  printf '%s' $(( num * 1024 * 1024 * 1024 )) ;;
    *)     return 1 ;;
  esac
}

# Human-readable byte count for a guard message: exact GiB -> "8 GiB", exact
# MiB -> "512 MiB", else raw bytes. Integer-exact only; guards never print a
# rounded number that would make the arithmetic look wrong.
# See change: stabilize-browser-e2e (#451 part 2).
human_bytes() {
  local b="${1:-0}"
  if [ $(( b % 1073741824 )) -eq 0 ]; then
    printf '%s GiB' $(( b / 1073741824 ))
  elif [ $(( b % 1048576 )) -eq 0 ]; then
    printf '%s MiB' $(( b / 1048576 ))
  else
    printf '%s B' "$b"
  fi
}
