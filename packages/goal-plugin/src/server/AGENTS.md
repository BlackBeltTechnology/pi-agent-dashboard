# DOX — packages/goal-plugin/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Server entry. `registerPiHandler("goal_status")` caches snapshot per session, `broadcastToSubscribers` a `plugin_event`. `registerBrowserHandler("plugin_action")` maps set/pause/resume/done/clear/subgoal → `/goal …` via `goalCommandFor`, dispatches with `sendToSession`. `cleared` status deletes cache. See change: add-goal-continuation-plugin. `detectGoalCommandSurface()` baselines `{acceptsSubgoal:true}`. `probeGoalCommandSurface` picks tier, logs it. `goalCommandFor(action,payload,tier)` gains `config` action → `goalConfigCommand`. See change: sophisticate-goal-authoring-and-control. |
| `probe.ts` | `probeGoalCommandSurface(surface?)` → tier `full`\|`criteria-dashboard-budget`\|`intent-only`. `goalConfigCommand(tier,{budget,judge})` emits `/goal config …` only in full tier (upgrade seam), else null. `tierEnforcesBudgetDashboardSide(tier)`. Extension not vendored; baseline tier `criteria-dashboard-budget`. See change: sophisticate-goal-authoring-and-control. |
