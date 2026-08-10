# git-status-cache.ts — index

Per-cwd git-status cache for the on-demand delivery half. Exports `useGitStatus(cwd, fallback)` (`useSyncExternalStore`; cached wins over the broadcast fallback), `refreshGitStatus(cwd)` (fetch → cache), `setCachedGitStatus`, `getCachedGitStatus`. Keyed by cwd → folder header + solo card at one path share ONE entry. See change: add-session-uncommitted-indicator-and-commit.
