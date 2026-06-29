---
executable: bash
description: Dashboard server config (secrets redacted). Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/config" | jq .
