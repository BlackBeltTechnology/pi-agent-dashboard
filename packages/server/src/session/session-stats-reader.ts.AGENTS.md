# session-stats-reader.ts — index

Exports `SessionStats`, `extractSessionStats(filePath)` — reads session JSONL once, accumulates tokensIn/Out, cacheRead/Write, cost from every usage kind (shared `entryUsage`; see change: count-non-message-usage), tracks lastTotalTokens (assistant only), infers contextWindow from model. `inferContextWindow(model)` hardcoded heuristic per provider.

Counts every usage kind via shared `entryUsage` (assistant, tool result, compaction, branch summary, `usage` entries incl. unknown kinds); only assistant usage sets `lastTotalTokens`. See change: count-non-message-usage.
