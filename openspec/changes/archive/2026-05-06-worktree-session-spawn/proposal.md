## Why

Pi sessions spawned from the dashboard always share the repository's main working tree. When multiple agents edit files in the same checkout, they risk clobbering each other's changes. Git worktree isolation solves this — each session gets its own checkout. The dashboard should make this a first-class action, with a UI that works on mobile screens where session management is most painful.

## What Changes

- New spawn action: "Spawn in worktree" — creates a git worktree for a selected branch and launches a pi session inside it
- Branch picker integrated into the spawn flow (reuse existing `BranchPicker`)
- Worktree-aware session listing: sessions in worktrees show branch name and a worktree indicator
- New API endpoint for worktree management: list existing worktrees, remove stale ones
- Mobile-friendly spawn dialog: full-screen sheet with large touch targets, branch typeahead, and clear action button
- `process-manager` extended with a pre-spawn hook that runs `git worktree add` before launching pi

## Capabilities

### New Capabilities

- `worktree-session-spawn`: Create a git worktree and spawn a pi session inside it from the dashboard UI. Covers the spawn flow, API endpoints, worktree lifecycle (create on spawn, offer cleanup on session end), and mobile-friendly dialog UI.

### Modified Capabilities

- `process-manager`: Add a pre-spawn step abstraction so worktree creation can run before pi launch
- `session-listing`: Add worktree branch indicator to session cards

## Impact

- `packages/server/src/process-manager.ts` — pre-spawn hook and worktree creation logic
- `packages/server/src/routes/session-routes.ts` — new spawn modes, worktree listing endpoint
- `packages/client/src/components/` — new `WorktreeSpawnDialog`, changes to `SessionCard`
- `packages/server/src/` — new `worktree-manager.ts` for `git worktree` operations
- Reuses existing `BranchPicker` component for branch selection
- No new dependencies; relies on `git worktree` CLI already available
