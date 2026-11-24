# DOX — packages/agent-teams-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `i18n.ts` | i18n `catalog` (unprefixed keys; `en` + zh-CN + hu identical key sets). One `title` key so `scripts/i18n-parity.mjs` covers the plugin (it skips empty catalogs). |
| `configSchema.json` | Settings + defaults: `maxTeammates` 5 (1–10), `maxActiveTeams` 3, `maxTasks` 50, `maxMessageChars` 8000, `mailRatePerMin` 6, `pairExchangeLimit` 10, `maxResultChars` 4000, `maxFinalTextChars` 2000, `maxMailLogBytes` 2 MiB, `closedRetentionDays` 7, `wakeConfirmMs` 15000, `urgentSettleWaitMs` 2500, `notifyCoalesceMs` 2000, `spawnTimeoutMs` 30000, `shutdownGraceMs` 10000, `reconcileGraceMs` 30000, `orphanTtlMs` 1800000, `opGateBudgetMs` 12000, `autoDispatch`, `blockSleepPolling`, `blockGitWrite` true, `extraCwdRoots` []. See change: add-agent-teams-core., `teammateMode` (unset ⇒ `session`). |
