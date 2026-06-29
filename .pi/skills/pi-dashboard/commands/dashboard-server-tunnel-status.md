---
executable: bash
description: Tunnel status + public URL. Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/tunnel-status" \
  | jq -r '"status=\(.status)  url=\(.url // "-")  os=\(.serverOs // "-")"'
