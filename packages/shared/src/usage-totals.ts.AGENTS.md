# usage-totals.ts — index

Pure usage summing shared by bridge `usageSeed`, `session-stats-reader.ts`, `state-replay.ts`. Exports `STATS_EXTRACTOR_VERSION` (2), `UsageTotals`, `entryUsage` (kinds `turn`/`tool`/`compaction`/`branch_summary`/`usage:<kind>`), `drainableEntryUsage` (usage/compaction/branch_summary only — never messages), `usageToTotals`, `sumEntryUsage`, `addUsageTotals`, `emptyUsageTotals`. See change: count-non-message-usage.
