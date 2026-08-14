# preferences-worktree-init-routes.ts — index

REST routes `GET /api/preferences/worktree-auto-init` (returns `{autoInitWorktreeOnSpawn:boolean}`) + `PATCH /api/preferences/worktree-auto-init` (body `{value:boolean}` → `preferences-store.setAutoInitWorktreeOnSpawn`). Stores flag only; trusted auto-trigger lives client-side. See change: auto-init-worktree-on-spawn.
