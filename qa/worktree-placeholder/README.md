# Worktree Placeholder Browser Test

Verifies that placeholder cards are correctly replaced by real session cards
when spawning pi sessions in git worktrees.

## Prerequisites

- Docker
- Built dashboard client (`npm run build`)

## Run

```bash
docker build -f qa/worktree-placeholder/Dockerfile -t pi-dashboard-worktree-placeholder-test .
docker run --rm pi-dashboard-worktree-placeholder-test
```

## What it tests

1. Placeholder card (`data-testid="placeholder-session-card"`) appears at top of group after clicking "Worktree" → "Create & Spawn"
2. Placeholder is the first card in the group (before any real session cards)
3. After the session registers, placeholder is removed
4. Real session card appears at the top of the group (not bottom)
5. Worktree session is correctly grouped under the parent repo (groupCwd)

See change: fix-worktree-placeholder-replacement.
