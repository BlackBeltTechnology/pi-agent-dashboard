#!/usr/bin/env bash
# Test: agent-teams UI — snapshot epoch/ETag across a real server restart (L2).
# See change: add-agent-teams-ui (test-plan S53, L2 half; the L1 half is
# packages/agent-teams-plugin/src/server/__tests__/epoch.test.ts).
#
#   S53  the snapshot `epoch` is constant within one server start and changes
#        across a real restart; an ETag minted before the restart no longer
#        answers 304 afterwards (200 with the full body), while the new ETag does.
#
# Needs one persisted team to read a snapshot from. This script does not create
# one (that takes the faux-lead drive of 60-agent-teams-core.sh); it SKIPs (first
# line + exit 0) when the server, the plugin or a team is absent. Reads only
# (`GET /api/plugins/agent-teams/teams[/:id]`) plus the supported `POST /api/restart`.
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

BASE="http://localhost:8000"
API="$BASE/api/plugins/agent-teams"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "SKIP: dashboard server not running (health=$HTTP_CODE)"
  exit 0
fi

LIST=$(curl -s "$API/teams" 2>/dev/null || true)
if ! echo "$LIST" | grep -q '"teams"'; then
  echo "SKIP: agent-teams plugin routes not available on this dashboard server"
  exit 0
fi

TEAM_ID=$(echo "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).teams;process.stdout.write(t&&t[0]?t[0].id:"")}catch{}})')
if [ -z "$TEAM_ID" ]; then
  echo "SKIP: no team to read a snapshot from (run 60-agent-teams-core.sh first)"
  exit 0
fi

echo "=== Test: agent-teams UI (epoch and ETag across a restart) ==="

epoch_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).epoch||"")))'; }
etag_of() { curl -s -D - -o /dev/null "$API/teams/$TEAM_ID" | tr -d '\r' | sed -n 's/^[Ee][Tt]ag: //p' | head -1; }

EPOCH_A=$(curl -s "$API/teams/$TEAM_ID" | epoch_of)
if [ -z "$EPOCH_A" ]; then
  echo "FAIL (S53): the snapshot carries no epoch"
  exit 1
fi
for _ in 1 2 3 4 5; do
  E=$(curl -s "$API/teams/$TEAM_ID" | epoch_of)
  if [ "$E" != "$EPOCH_A" ]; then
    echo "FAIL (S53): epoch changed within one server start ($EPOCH_A -> $E)"
    exit 1
  fi
done

ETAG_A=$(etag_of)
if [ -z "$ETAG_A" ]; then
  echo "FAIL (S53): the snapshot answer carries no ETag"
  exit 1
fi
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "If-None-Match: $ETAG_A" "$API/teams/$TEAM_ID")
if [ "$CODE" != "304" ]; then
  echo "FAIL (S53): the current ETag did not answer 304 (got $CODE)"
  exit 1
fi

# Real restart through the single source of truth (/api/restart), then wait for health.
pi-dashboard api POST /api/restart >/dev/null 2>&1 || true
sleep 2
ELAPSED=0
while [ $ELAPSED -lt 60 ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null || echo "000")
  [ "$HTTP_CODE" = "200" ] && break
  sleep 1; ELAPSED=$((ELAPSED + 1))
done
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL (S53): server did not come back after /api/restart"
  exit 1
fi

EPOCH_B=$(curl -s "$API/teams/$TEAM_ID" | epoch_of)
if [ -z "$EPOCH_B" ] || [ "$EPOCH_B" = "$EPOCH_A" ]; then
  echo "FAIL (S53): epoch did not change across the restart ($EPOCH_A -> ${EPOCH_B:-none})"
  exit 1
fi

CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "If-None-Match: $ETAG_A" "$API/teams/$TEAM_ID")
if [ "$CODE" != "200" ]; then
  echo "FAIL (S53): an ETag from before the restart answered $CODE (expected 200)"
  exit 1
fi
ETAG_B=$(etag_of)
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "If-None-Match: $ETAG_B" "$API/teams/$TEAM_ID")
if [ "$CODE" != "304" ]; then
  echo "FAIL (S53): the new ETag did not answer 304 (got $CODE)"
  exit 1
fi

echo "PASS: epoch $EPOCH_A -> $EPOCH_B across the restart; old ETag 200, new ETag 304"
