---
executable: bash
description: Dashboard server config (secrets redacted). Runs locally, no LLM.
---
eval "$PI_DASHBOARD_CLI" api GET /api/config | jq .
