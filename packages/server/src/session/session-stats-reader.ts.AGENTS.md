# session-stats-reader.ts — index

Exports `SessionStats`, `extractSessionStats(filePath)` — reads session JSONL once, accumulates tokensIn/Out, cacheRead/Write, cost from assistant usage, tracks lastTotalTokens, infers contextWindow from model. `inferContextWindow(model)` hardcoded heuristic per provider.
