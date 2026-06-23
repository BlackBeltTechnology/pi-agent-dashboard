# shellcheck shell=bash
# ---------------------------------------------------------------------------
# Pure port/project helpers for the parallel-worktree test harness.
# Sourced by test-up.sh and test-down.sh. No side effects on source.
# See change: parallelize-test-harness, docker/TESTING.md.
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
