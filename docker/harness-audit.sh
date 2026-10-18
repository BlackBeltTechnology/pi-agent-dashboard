#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Record docker container lifecycle events for the test-harness label set.
#
#   docker/harness-audit.sh /tmp/harness-events.log      # then start a run
#
# Why this exists (issue #451 part 1): a worktree's harness container was once
# observed destroyed MID-RUN by something outside its own `test-down.sh`. A grep
# audit of every `docker … down|rm|prune|stop|kill` in the tree found no in-repo
# caller that can reach a foreign `pi-dash-test-*` project — every teardown is
# `-p`-scoped to its own project — so the destroy came from outside the repo
# (manual action, a Docker Desktop restart, or an out-of-tree prune). That is a
# conclusion about TODAY's tree, not a fix. This helper turns the next
# occurrence into evidence instead of a timeline reconstructed after the fact.
#
# Leave it running across a whole harness lifecycle; it appends. Start it
# BEFORE `test-up.sh` so the `create`/`start` lines are captured too.
#
# Filters are ANDed across keys but ORed within the `event` key, so the event
# list below is a union. The grep keeps only the harness project namespace
# (`pi-dash-test-*`, derived from HOST_CWD by lib-ports.sh) — unrelated
# containers on the same daemon are not recorded.
#
# PROJECT-SCOPED MODE (change: add-missing-ci-legs, #451 part 1). `docker/test-up.sh`
# starts this itself, per harness, as `harness-audit.sh <file> <project>`, so the
# evidence exists BEFORE the incident instead of depending on a second shell:
#   - records only that compose project's events, each line carrying the
#     container ID (`id=<full id>`), and appends `boot <ISO ts> <project> <id>`
#     when it first sees a new container;
#   - ARMED RULE: it starts before `compose up`, so an empty container list is
#     expected at first. It is unarmed until it has seen its container (a
#     create/start event or a non-empty poll); once armed, the first empty poll
#     (default every 30 s) ends it. An interrupted run that never reached
#     test-down.sh therefore leaks at most one poll interval after the container
#     is gone;
#   - hard maximum lifetime (default 12 h) regardless of Docker state.
# Tunables (tests inject small values): PI_HARNESS_AUDIT_POLL_SECS,
# PI_HARNESS_AUDIT_MAX_SECS. The unscoped manual mode below is unchanged.
#
# See change: stabilize-browser-e2e, tests/e2e/README.md ("When a run dies
# mid-way"), docker/TESTING.md.
# ---------------------------------------------------------------------------
set -euo pipefail

OUT="${1:-}"
PROJECT="${2:-}"
if [ -z "$OUT" ] || [ "$OUT" = "-h" ] || [ "$OUT" = "--help" ]; then
  cat >&2 <<'USAGE'
usage: harness-audit.sh <output-file> [<compose-project>]

Append docker container events for pi-dash-test-* projects to <output-file>.
Start it BEFORE test-up.sh; stop with Ctrl-C. Creates parent dirs as needed.
With <compose-project> (what test-up.sh passes) it records only that project,
self-terminates once its container is gone, and is capped at 12 h.

  docker/harness-audit.sh /tmp/harness-events.log
  # … another shell: cd <worktree> && docker/test-up.sh -d && docker/test-down.sh
  # then grep /tmp/harness-events.log for the destroy that was not ours.
USAGE
  [ -n "$OUT" ] && exit 0
  exit 2
fi

mkdir -p "$(dirname "$OUT")"

if [ -n "$PROJECT" ]; then
  POLL="${PI_HARNESS_AUDIT_POLL_SECS:-30}"
  MAX="${PI_HARNESS_AUDIT_MAX_SECS:-43200}"
  ARM="$(mktemp "${TMPDIR:-/tmp}/harness-audit-armed.XXXXXX")"
  rm -f "$ARM" # created by the reader on the first create/start/poll hit
  iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

  # One subshell job = one process group (`set -m`), so cleanup kills the whole
  # `docker events | while read` pipeline with a single signal.
  set -m
  (
    docker events \
      --filter type=container \
      --filter "label=com.docker.compose.project=${PROJECT}" \
      --filter event=create \
      --filter event=start \
      --filter event=die \
      --filter event=destroy \
      --filter event=kill \
      --format '{{.Time}} {{.Action}} {{.Actor.Attributes.name}} project={{index .Actor.Attributes "com.docker.compose.project"}} id={{.Actor.ID}}' \
      | while IFS= read -r line; do
          case "$line" in *" project=${PROJECT} "*) ;; *) continue ;; esac # never record a foreign project
          printf '%s\n' "$line" >> "$OUT"
          case "$line" in
            *" create "*|*" start "*)
              : > "$ARM"
              id="${line##* id=}"
              grep -q "^boot .* ${id}\$" "$OUT" 2>/dev/null || printf 'boot %s %s %s\n' "$(iso)" "$PROJECT" "$id" >> "$OUT"
              ;;
          esac
        done
  ) &
  EVENTS_PGID=$!

  stop_events() { kill -TERM -- "-${EVENTS_PGID}" 2>/dev/null || kill -TERM "$EVENTS_PGID" 2>/dev/null || true; rm -f "$ARM"; }
  trap 'stop_events; exit 0' INT TERM
  trap 'stop_events' EXIT

  # An unusable event stream (permissions, no daemon) ends the pipeline at once;
  # a recorder that records nothing must not linger.
  # `jobs -r` (running only): a finished-but-unreaped job still answers kill -0.
  events_alive() { [ -n "$(jobs -r)" ]; }
  sleep 0.4
  if ! events_alive; then
    echo "harness-audit: docker events ended immediately; exiting" >&2
    exit 1
  fi

  started="$(date +%s)"
  # 1 s ticks: a dead event stream (or the lifetime cap) is noticed within a
  # second even when the container poll interval is 30 s.
  last_poll="$started"
  while :; do
    sleep 1 & wait $! || true
    if ! events_alive; then
      echo "harness-audit: docker events ended unexpectedly; exiting" >&2
      exit 1
    fi
    if [ $(( $(date +%s) - started )) -ge "$MAX" ]; then
      echo "harness-audit: ${MAX}s maximum lifetime reached; exiting" >&2
      exit 0
    fi
    [ $(( $(date +%s) - last_poll )) -ge "$POLL" ] || continue
    last_poll="$(date +%s)"
    ids="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null || true)"
    if [ -n "$ids" ]; then
      : > "$ARM" # a non-empty poll also arms (covers a missed create event)
    elif [ -e "$ARM" ]; then
      exit 0 # armed + container gone: the harness is over
    fi
  done
fi

echo "stabilize-browser-e2e: recording docker container events for pi-dash-test-* -> ${OUT}" >&2
echo "  start before test-up.sh; Ctrl-C to stop." >&2

exec docker events \
  --filter type=container \
  --filter event=create \
  --filter event=start \
  --filter event=die \
  --filter event=destroy \
  --filter event=kill \
  --format '{{.Time}} {{.Action}} {{.Actor.Attributes.name}} project={{index .Actor.Attributes "com.docker.compose.project"}}' \
  | grep --line-buffered 'project=pi-dash-test-' >> "$OUT"
