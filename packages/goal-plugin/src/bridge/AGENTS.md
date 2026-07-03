# DOX — packages/goal-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Thin bridge entry. `pi.on("message_end")` filters customType `pi-goal-hermes:event`, maps details via `detailsToSnapshot`, emits `pi.events.emit("dashboard:plugin-message", {pluginId, messageType:"goal_status", payload})`. No judge, no sendUserMessage. See change: add-goal-continuation-plugin. |
