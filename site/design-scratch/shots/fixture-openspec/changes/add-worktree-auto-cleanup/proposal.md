# Proposal — Add worktree auto cleanup

## Why

Shipped worktrees linger on disk until someone notices. A stale worktree still shows a folder card.

## What Changes

- Detect merged branches with no live session.
- Offer a batch cleanup with a dry-run preview.

## Discipline Skills

None apply: this change adds UI surface with no new external call, auth path or latency budget.
