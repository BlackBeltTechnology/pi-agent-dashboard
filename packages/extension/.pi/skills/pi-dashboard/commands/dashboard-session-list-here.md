---
executable: bash
description: List sessions whose cwd matches the current directory. Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/sessions" \
  | jq -r --arg pwd "$PWD" '.data[]
      | select(.cwd==$pwd)
      | "\(.id[0:8])  \(.status // "-")  \(.name // "-")"'
