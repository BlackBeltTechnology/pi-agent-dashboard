# DOX — packages/goal-plugin/src/shared

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `goal-types.ts` | Shared types. `GoalStatus` (active\|paused\|done\|cleared), `GoalStatusSnapshot`, `GoalHermesEventDetails`. Constants `GOAL_PLUGIN_ID`, `GOAL_STATUS_MESSAGE`, `GOAL_HERMES_EVENT_CUSTOM_TYPE`, `GOAL_STATUS_EVENT_TYPE`. `detailsToSnapshot(details)` maps extension eventType → snapshot (goal-achieved→done, goal-paused→paused, goal-cleared→cleared, else active). See change: add-goal-continuation-plugin. |
