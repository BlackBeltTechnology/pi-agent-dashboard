# DOX — packages/client/src/lib/claude-compat

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `claude-compat-store.ts` | Module-level store for the global Claude subscription compat switch. `claudeCompatStore.read()` (GET `/api/preferences/claude-subscription-compat`; unreadable → `null`, state unchanged), `.set(v)` (optimistic publish → PATCH → revert on failure, resolves saved boolean; write-seq guards stale replies), `useClaudeCompat()` (`useSyncExternalStore`, `value: boolean | null`). Test hooks `__resetForTests`, `__setForTests`. See change: retire-anthropic-messages-bridge. |
