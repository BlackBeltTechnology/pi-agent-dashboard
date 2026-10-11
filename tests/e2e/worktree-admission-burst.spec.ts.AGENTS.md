# worktree-admission-burst.spec.ts — index

L3 (docker harness). Replaces the container's `git` at its resolved path with a shim that sleeps 0.5 s then execs the real binary (the server's tool registry caches the git path, so a `PATH` edit would not be seen). Pinned repo with 3 worktrees shown as live session cards and 3 sessionless, unpinned worktrees whose admission MUST derive the main checkout via git. Asserts: no 403 for any worktree cwd on `/api/mcp-client/effective` or `/api/kb/stats` (200, or a transient 503 that converges), and the worktree MCP pills settle to a server-count summary (no loading / error / not-tracked). `afterAll` restores git, unpins, removes the fixture.

See change: harden-plugin-cwd-admission (test-plan #F10).
