---
executable: bash
description: List known remote dashboard servers. Runs locally, no LLM.
---
eval "$PI_DASHBOARD_CLI" api GET /api/known-servers \
  | jq -r '.data[]? | "\(.label // "-")  \(.host):\(.port)"'
