---
executable: bash
description: Show every field of a session by id-prefix. Usage /dashboard:session-info <id>. Runs locally, no LLM.
---
ID="$1"
if [ -z "$ID" ]; then echo "usage: /dashboard:session-info <id-prefix>" >&2; exit 2; fi
curl -s "$PI_DASHBOARD_BASE/api/sessions" \
  | jq -r --arg id "$ID" '
      (.data[] | select(.id | startswith($id)))
      // ("no session matching " + $id | halt_error(1))
      | to_entries[] | "\(.key): \(.value)"'
