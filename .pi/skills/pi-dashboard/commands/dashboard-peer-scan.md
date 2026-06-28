---
executable: bash
description: mDNS scan for peer dashboard servers on the network. Runs locally, no LLM.
---
curl -s -X POST "$PI_DASHBOARD_BASE/api/discover-servers" \
  | jq -r '.data[]? | "\(.host):\(.port)  v\(.version // "-")  \(if .isLocal then "(local)" else "" end)"'
