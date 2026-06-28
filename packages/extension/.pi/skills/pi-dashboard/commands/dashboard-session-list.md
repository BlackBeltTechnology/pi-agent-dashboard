---
executable: bash
description: List all pi sessions (id, status, name, cwd). Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/sessions" \
  | jq -r '.data[] | "\(.id[0:8])  \(.status // "-")  \(.name // "-")  \(.cwd)"'
