#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────
CWD=""
BASE_BRANCH=""
BRANCH=""
LABEL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cwd) CWD="$2"; shift 2 ;;
    --base) BASE_BRANCH="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$CWD" || -z "$BASE_BRANCH" || -z "$BRANCH" ]]; then
  echo "Usage: spawn.sh --cwd <path> --base <branch> --branch <new-branch> [--label <label>]" >&2
  exit 1
fi

# ── Discover dashboard ─────────────────────────────────────────────────────
PORT=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$HOME/.pi/dashboard/config.json" 2>/dev/null | grep -o '[0-9]*' || echo 8000)
BASE="http://localhost:$PORT"

# Verify dashboard is running
if ! curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
  echo "Dashboard not running on port $PORT. Start it with: pi-dashboard start" >&2
  exit 1
fi

# ── Spawn worktree ─────────────────────────────────────────────────────────
PAYLOAD=$(cat <<EOF
{
  "cwd": "$CWD",
  "spawnMode": "worktree",
  "branch": "$BRANCH",
  "baseBranch": "$BASE_BRANCH"
  $([ -n "$LABEL" ] && echo ', "label": "'"$LABEL"'"')
}
EOF
)

RESPONSE=$(curl -s -X POST "$BASE/api/session/spawn" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD")

# ── Output ─────────────────────────────────────────────────────────────────
echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    wp = data.get('data', {}).get('worktreePath', '')
    print(json.dumps({'worktreePath': wp, 'branch': '$BRANCH'}))
else:
    print(json.dumps({'error': data.get('error', 'unknown')}))
    sys.exit(1)
"
