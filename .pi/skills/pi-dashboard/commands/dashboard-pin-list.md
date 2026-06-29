---
executable: bash
description: List pinned directories. Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/pinned-dirs" | jq -r '.data[]?'
