---
executable: bash
description: Show file changes (git diff) for a session by id-prefix. Usage /dashboard:session-diff <id>. Runs locally, no LLM.
---
ID="$1"
if [ -z "$ID" ]; then echo "usage: /dashboard:session-diff <id-prefix>" >&2; exit 2; fi
FULL=$(curl -s "$PI_DASHBOARD_BASE/api/sessions" \
  | jq -r --arg id "$ID" '.data[] | select(.id | startswith($id)) | .id' | head -1)
if [ -z "$FULL" ]; then echo "no session matching $ID" >&2; exit 1; fi
curl -s "$PI_DASHBOARD_BASE/api/session-diff?sessionId=$FULL" \
  | jq -r '.data.files[]? | "=== \(.path) ===\n\(.gitDiff // "(no git diff)")"'
