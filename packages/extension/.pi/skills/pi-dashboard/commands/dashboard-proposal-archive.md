---
executable: bash
description: List archived OpenSpec changes for the current dir (newest first). Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/openspec-archive?cwd=$PWD" \
  | jq -r '.data | sort_by(.date) | reverse[] | "\(.date)  \(.name)"'
