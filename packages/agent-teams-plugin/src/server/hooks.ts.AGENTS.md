# hooks.ts — index

`createHookGates`/`registerHooks`: `TaskCreate`, `TaskUpdate→completed` and `TeammateIdle` op gates over the engine. Hooks only from frozen `team.hooks`. `hook_blocked`; `hook_pending` (concurrent completion), `hook_busy` (no start before deadline); idle: skip shutdown_pending/error/pending-plan, `hook_feedback` mail via `afterBlock`, `hookMaxRetries`. See change: add-agent-teams-templates-hooks.
