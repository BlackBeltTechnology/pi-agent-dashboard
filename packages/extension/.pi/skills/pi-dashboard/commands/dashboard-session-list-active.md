---
executable: bash
description: List active/streaming sessions only. Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/sessions" \
  | jq -r '.data[]
      | select(.status=="streaming" or .status=="active")
      | "\(.id[0:8])  \(.status)  \(.name // "-")  \(.cwd)"'
