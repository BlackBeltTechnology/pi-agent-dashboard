#!/usr/bin/env bash
# Seed the running harness with a real screenshot corpus.
#
# ORDER MATTERS. docker/test-entrypoint.sh rebuilds BOTH /fixtures (from the
# read-only /fixtures-src bind) and the pi state volume on every container
# boot, so anything seeded before a `docker restart` is erased. Seed into the
# LIVE container, then restart only the SERVER PROCESS via /api/restart so
# session-scanner re-reads the store without re-running the entrypoint.
#
#   design-scratch/shots/seed.sh [port]
set -euo pipefail

PORT="${1:-18916}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FIX=/fixtures/sample-git

C=$(docker ps --filter "publish=$PORT" --format '{{.Names}}' | head -1)
[ -n "$C" ] || { echo "no container on port $PORT — run docker/test-up.sh first" >&2; exit 1; }
echo "container: $C"

echo "==> transplanting real session logs"
PW_E2E_PORT="$PORT" node "$HERE/corpus.mjs" --count 8 | tail -12

echo "==> seeding fixture source files"
# `docker cp` refuses this destination (the fixture dir lives in the container's
# writable layer, not a bind), so stream a tar through exec instead.
tar -cf - -C "$HERE/fixture" src package.json tsconfig.json AGENTS.md .pi \
  | docker exec -i "$C" tar -xf - -C "$FIX"

echo "==> committing the new tree"
# Single-quoted: no host-side expansion of $ or backticks inside the remote
# script, and no python3 in the image (build deps are purged in the app stage).
docker exec "$C" sh -lc '
  set -e
  cd /fixtures/sample-git
  git checkout -- README.md 2>/dev/null || true
  git add -A src package.json tsconfig.json AGENTS.md
  git -c user.email=dev@example.com -c user.name="Sample Dev" \
      commit -q -m "Add session store, formatters and unit tests" || true
  git log --oneline
'

echo "==> populating the OpenSpec board (groups + changes)"
PW_E2E_PORT="$PORT" node "$HERE/board.mjs" --port "$PORT"
# Commit the board too, so the ONLY uncommitted work is the curated 3-file
# change set below. Otherwise the commit dialog screenshots 17 files of
# openspec scaffolding instead of a readable diff.
docker exec "$C" sh -lc '
  cd /fixtures/sample-git
  git add openspec
  git -c user.email=dev@example.com -c user.name="Sample Dev" \
      commit -q -m "Populate OpenSpec board: 4 groups, 11 changes" || true
'

echo "==> seeding plugin surfaces (automations + goals)"
PW_E2E_PORT="$PORT" node "$HERE/plugins.mjs" --port "$PORT"

echo "==> overlaying dirty variants (uncommitted work for the diff view)"
# An uncommitted change set is what the diff viewer and the commit dialog
# actually render. Without it both surfaces are structurally unreachable.
tar -cf - -C "$HERE/fixture-dirty" src | docker exec -i "$C" tar -xf - -C "$FIX"
docker exec "$C" sh -lc '
  cd /fixtures/sample-git
  printf "\n## Development\n\nRun \`npm test\` before pushing.\n" >> README.md
  git status --short
  echo "--- diffstat ---"
  git diff --stat
'

echo "==> restarting the SERVER PROCESS (not the container)"
curl -s -X POST "http://127.0.0.1:$PORT/api/restart" -o /dev/null || true
for i in $(seq 1 40); do
  code=$(curl -s -m 3 -o /tmp/seed-health.json -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || true)
  [ "$code" = "200" ] && { echo "healthy again after ~$((i*2))s"; break; }
  sleep 2
done

curl -s -o /tmp/seed-sessions.json "http://127.0.0.1:$PORT/api/sessions"
node -e "
const d=require('/tmp/seed-sessions.json');
const a=Array.isArray(d)?d:(d.sessions||d.data||[]);
console.log('sessions visible:',a.length);
for(const s of a.slice(0,10)) console.log('  ',(s.state||s.status||'?').padEnd(9),s.name);
"
