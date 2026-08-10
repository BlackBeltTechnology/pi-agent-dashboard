# stats-extractor.ts — index

Extracts `StatsData` (tokensIn/out, cost, turnUsage, optional contextUsage) from a `turn_end` event's `message.usage`. Exports `StatsData`, `extractTurnStats(event, contextUsage?)`. Returns null when no usage present.
