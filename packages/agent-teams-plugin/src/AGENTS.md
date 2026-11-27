# DOX — packages/agent-teams-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `i18n.ts` | i18n `catalog` (unprefixed keys; `en` + zh-CN + hu identical key sets). Static export of the main client entry → lands in cold chunk. Badge labels ONLY (`badgeLead`, `badgeTeam`, `badgeOpen` `{role}`); budget ≤ 400 B gz. Every other string = table inside the lazy module (pick locale with `useLanguage()`). See change: add-agent-teams-ui. |
| `configSchema.json` | Settings + defaults: `maxTeammates` 5 (1–10), `maxActiveTeams` 3, `maxTasks` 50, `maxMessageChars` 8000, `mailRatePerMin` 6, `pairExchangeLimit` 10, `maxResultChars` 4000, `maxFinalTextChars` 2000, `maxMailLogBytes` 2 MiB, `closedRetentionDays` 7, `wakeConfirmMs` 15000, `urgentSettleWaitMs` 2500, `notifyCoalesceMs` 2000, `spawnTimeoutMs` 30000, `shutdownGraceMs` 10000, `reconcileGraceMs` 30000, `orphanTtlMs` 1800000, `opGateBudgetMs` 12000, `autoDispatch`, `blockSleepPolling`, `blockGitWrite` true, `extraCwdRoots` []. See change: add-agent-teams-core., `teammateMode` (unset ⇒ `session`). Adds `maxTemplateBytes` 65536, `hookTimeoutMs` 10000, `hookMaxRetries` 3, `planMaxChars` 6000, `planModeTools` [read, grep, find, ls]. See change: add-agent-teams-templates-hooks. Adds `inProcessIdleTtlSec` (≥1 or absent), `inProcessLeanChildren` false, `inProcessCmdTimeoutMs` 10000 (1000–120000), `inProcessQueueTimeoutMs` (≥1 or absent); `teammateMode` enum `session|in-process`. See change: add-agent-teams-in-process. |
