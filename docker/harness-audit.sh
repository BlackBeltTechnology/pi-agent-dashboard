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
# See change: stabilize-browser-e2e, tests/e2e/README.md ("When a run dies
# mid-way"), docker/TESTING.md.
# ---------------------------------------------------------------------------
set -euo pipefail

OUT="${1:-}"
if [ -z "$OUT" ] || [ "$OUT" = "-h" ] || [ "$OUT" = "--help" ]; then
  cat >&2 <<'USAGE'
usage: harness-audit.sh <output-file>

Append docker container events for pi-dash-test-* projects to <output-file>.
Start it BEFORE test-up.sh; stop with Ctrl-C. Creates parent dirs as needed.

  docker/harness-audit.sh /tmp/harness-events.log
  # … another shell: cd <worktree> && docker/test-up.sh -d && docker/test-down.sh
  # then grep /tmp/harness-events.log for the destroy that was not ours.
USAGE
  [ -n "$OUT" ] && exit 0
  exit 2
fi

mkdir -p "$(dirname "$OUT")"

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
