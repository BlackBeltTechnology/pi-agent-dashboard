# active-sessions-in-cwd.ts — index

Pure helpers `isPathInside(parent, child)`, `activeSessionsUnder(path, sessions)` (excludes `status === "ended"`), `sessionsUnder(path, sessions)` (includes ended). Case-folds per OS via shared `normalizePath`. Drives pre-removal `active_sessions` guard + `cwd_missing` broadcast loop. See change: add-worktree-lifecycle-actions.
