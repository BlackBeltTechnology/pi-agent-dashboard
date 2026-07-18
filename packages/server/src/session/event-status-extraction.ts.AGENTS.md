# event-status-extraction.ts — index

Extract session status/tool/model stats from forwarded events. Exports `extractStatsFromEvents` (accumulate token/cost/context totals from `stats_update` batch), `extractSessionUpdates` (per-event `status`/`currentTool`/`model`/`thinkingLevel` deltas from `agent_start`/`agent_end`/`tool_execution_*`/`model_select`), `isActivityEvent` (narrow allowlist for `lastActivityAt` stamping), `isUnreadTrigger` (streaming→idle/active, `ask_user` flip, `agent_end` with error). Flows/architect events excluded (plugin-owned).
