---
name: worktree-spawn
description: >
  Spawn a pi session inside an isolated git worktree. Creates a new branch
  from a base branch, creates a worktree, and launches a pi session inside it
  — all via the dashboard REST API. Use when subagents need to work in
  isolation, or when you want to branch off and start a parallel task without
  touching the main checkout.
license: MIT
compatibility: Requires pi-dashboard server running (default port 8000).
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Worktree Spawn

Create an isolated git worktree with a pi session inside it. The worktree gets its own branch, checkout, and agent — changes stay isolated until you merge.

## Quick Start

```bash
bash .pi/skills/worktree-spawn/scripts/spawn.sh \
  --cwd /path/to/repo \
  --base develop \
  --branch feature/my-task
```

Returns JSON with the worktree path:

```json
{ "worktreePath": "/path/to/.pi-worktrees/feature-my-task-...", "branch": "feature/my-task" }
```

## Step-by-Step

### 1. Verify dashboard is running

```bash
PORT=$(cat ~/.pi/dashboard/config.json 2>/dev/null | grep '"port"' | grep -o '[0-9]*' || echo 8000)
BASE="http://localhost:$PORT"

curl -s "$BASE/api/health" | jq .
# Expected: { "ok": true }
```

If not running, start it: `pi-dashboard start`

### 2. Verify the directory is a git repo

```bash
curl -s "$BASE/api/git/branches?cwd=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$CWD")" | jq .
# Returns branch list or { "success": false, "error": "not a git repository" }
```

### 3. Spawn the worktree

```bash
curl -s -X POST "$BASE/api/session/spawn" \
  -H 'Content-Type: application/json' \
  -d '{
    "cwd": "/path/to/repo",
    "spawnMode": "worktree",
    "branch": "feature/my-task",
    "baseBranch": "develop"
  }' | jq .
```

**Parameters:**

| Field | Required | Description |
|-------|----------|-------------|
| `cwd` | ✅ | Path inside the target git repository (repo root resolved automatically) |
| `spawnMode` | ✅ | Must be `"worktree"` |
| `branch` | ✅ | Name of the NEW branch to create in the worktree |
| `baseBranch` | ✅ | Branch to branch FROM (e.g. `develop`, `main`, `origin/main`) |
| `label` | ❌ | Human-readable label for the worktree directory name |

**Success response:**

```json
{
  "success": true,
  "data": {
    "message": "Pi session spawned...",
    "worktreePath": "/path/to/.pi-worktrees/feature-my-task-1712345678901"
  }
}
```

**Error responses:**

| Error code | Meaning |
|------------|---------|
| `not_a_git_repo` | cwd is not inside a git repository |
| `branch_not_found` | base branch doesn't exist |
| `branch_already_checked_out` | new branch name already exists or is checked out |
| `dirty_working_tree` | uncommitted changes conflict with the checkout |
| `git_unavailable` | git binary not found on PATH |

### 4. The session appears in the dashboard

After spawn, the pi session connects to the dashboard. The session card will show a worktree indicator with the branch name. The session can be monitored via:

```bash
curl -s "$BASE/api/sessions" | jq '.data[] | select(.worktree != null)'
```

### 5. Cleanup (when done)

When the task is complete, clean up the worktree:

```bash
curl -s -X DELETE "$BASE/api/git/worktrees" \
  -H 'Content-Type: application/json' \
  -d '{
    "cwd": "/path/to/repo",
    "path": "/path/to/.pi-worktrees/feature-my-task-..."
  }' | jq .
```

## Helper Script

Use [scripts/spawn.sh](scripts/spawn.sh) for a one-command spawn:

```bash
bash .pi/skills/worktree-spawn/scripts/spawn.sh \
  --cwd /path/to/repo \
  --base develop \
  --branch feature/my-task \
  --label "review"
```

## Recipes

### Subagent: implement feature on a new branch

```
1. Call worktree-spawn with --cwd <repo> --base develop --branch feature/xyz
2. The worktree path is returned — tell the subagent to cd there
3. Subagent works in isolation
4. When done, review the diff, commit, push, and clean up the worktree
```

### Multiple parallel features

```
1. Spawn worktree A: --branch feature/auth --base develop
2. Spawn worktree B: --branch feature/notifications --base develop
3. Each subagent works in its own worktree — no conflicts
4. Apply changes back to develop via PR/merge
```
