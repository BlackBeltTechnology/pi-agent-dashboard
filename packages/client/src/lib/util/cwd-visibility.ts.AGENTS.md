# cwd-visibility.ts — index

Pure `isVisibleCwd(cwd, {pinnedDirectories, workspaces, sessions, platform?})`. Uses `pathKey` (newly exported from `session-grouping.ts`) for trailing-slash / case-insensitive matching on win32/darwin. Returns true iff cwd matches any pinned dir, any `workspace.folders` entry, or any session's cwd. Drives off-screen `spawn_error` toast gating in `useMessageHandler`. See change: harden-worktree-spawn.
