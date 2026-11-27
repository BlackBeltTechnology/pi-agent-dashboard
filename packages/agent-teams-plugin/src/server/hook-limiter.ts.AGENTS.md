# hook-limiter.ts — index

`HookLimiter`: 2 per team, 4 global (`HOOK_TEAM_CONCURRENCY`/`HOOK_GLOBAL_CONCURRENCY`); queue inside caller deadline → `timeout` (never started); `cancelAll()` → `shutdown`. See change: add-agent-teams-templates-hooks.
