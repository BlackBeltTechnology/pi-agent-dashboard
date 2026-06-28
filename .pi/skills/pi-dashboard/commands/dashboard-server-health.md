---
executable: bash
description: Dashboard server liveness (pid, uptime). Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/health" \
  | jq -r '"ok=\(.ok)  pid=\(.pid)  uptime=\(.uptime)s"'
