---
executable: bash
description: mDNS scan for peer dashboard servers on the network. Runs locally, no LLM.
---
eval "$PI_DASHBOARD_CLI" api POST /api/discover-servers \
  | jq -r '.data[]? | "\(.host):\(.port)  v\(.version // "-")  \(if .isLocal then "(local)" else "" end)"'
