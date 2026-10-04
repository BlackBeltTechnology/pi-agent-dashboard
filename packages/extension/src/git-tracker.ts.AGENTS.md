# git-tracker.ts — index

Per-bridge git state: static-facts cache, HEAD-file branch reader, cached async `git status`, probe scheduler, git-dir watcher. `evaluateFirst(bc,cwd)` sync (registration / cwd or session change / reconnect): branch + worktree sent, status omitted, fast probe queued. `tick` = facts stamp + HEAD branch + `prStatus.observe` + one slow-lane request. `onToolEnd` requests a slow probe unless tool ∈ read|grep|find|ls|glob (case-insensitive). Probe: branch before/after (mismatch → discard + re-probe), stale cwd generation dropped, failure → update without `gitStatus`, PR observed even on failure. Exports `createGitTracker`, `GitTracker`, `GitTrackerDeps`.
See change: optimize-polling-hot-paths.
