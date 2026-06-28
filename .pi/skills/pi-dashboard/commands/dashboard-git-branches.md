---
executable: bash
description: List git branches for the current dir (current marked *). Runs locally, no LLM.
---
curl -s "$PI_DASHBOARD_BASE/api/git/branches?cwd=$PWD" \
  | jq -r '.data.branches[] | (if .isCurrent then "* " else "  " end) + .name'
