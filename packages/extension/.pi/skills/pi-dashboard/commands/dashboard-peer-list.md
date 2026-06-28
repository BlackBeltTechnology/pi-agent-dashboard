---
executable: bash
description: List known remote dashboard servers. Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/known-servers" \
  | jq -r '.data[]? | "\(.label // "-")  \(.host):\(.port)"'
