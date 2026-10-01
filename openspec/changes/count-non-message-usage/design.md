## Context

- **Live stats today.** The bridge forwards `turn_end`. The server's `extractTurnStats` (`shared/src/stats-extractor.ts`) reads `message.usage` and returns `null` without it. `event-wiring.ts:1196-1232` accumulates the result and synthesizes the `stats_update` event. `StatsUpdateMessage` was removed (`protocol.ts:383`). Cache tokens accumulate only via `turnUsage` (`event-wiring.ts:1204`, `event-reducer.ts:2496`, `event-status-extraction.ts:30-38`).
- **Client.** The reducer appends a `TurnStat` for every `stats_update` (`MAX_TURN_STATS = 50`). `TokenStatsBar` renders the reduced array.
- **Offline.** `session-stats-reader.ts:57-68` uses one loop for cost and `lastTotalTokens`. `session-scanner.ts:392-411` re-extracts only when the JSONL mtime is newer than the cache. Live registration of a fresh id zeroes totals (`memory-session-manager.ts:344-348`).
- **pi 0.99.1.**
  - `SessionManager.appendUsage` writes `UsageEntry` records.
  - `getEntries()` returns a full shallow copy; `getEntryCount()` is cheap.
  - `getSessionId()` is stable while the file is created lazily.
  - `CacheWarmer` refreshes while idle.
  - `cache_warming_decision` fires before each refresh, including the one that decides to stop, and accepts a decision result.

## Goals / Non-Goals

**Goals:** totals equal pi's for every kind; no double count; context gauge and turn chart unaffected; existing sessions corrected.

**Non-Goals:** a per-kind cost breakdown UI; changing pi's cache warming.

## Decisions

### D1 — One source per kind
| Usage | Live transport | JSONL source | Context gauge | TurnStat |
|---|---|---|---|---|
| assistant | `turn_end` (unchanged) | assistant message | yes | yes |
| tool result | `usage_recorded{kind:"tool"}` from the tool-result `message_end` | tool-result message | no | no |
| compaction / branch summary | `usage_recorded` via drain | entry `usage` | no | no |
| `usage` entry (any kind) | `usage_recorded{kind:"usage:<kind>"}` via drain | `type:"usage"` | no | no |

`turn_end.toolResults` is never counted.

### D2 — Bridge drain
- Cursor `{ sessionId, entryCount }`. At each drain point: if `getSessionId()` changed, set `entryCount = getEntryCount()` and forward nothing (history belongs to the registration seed, D4). Else, if `getEntryCount() > entryCount`, call `getEntries()`, forward the new usage-bearing entries, and advance.
- Drain points: `turn_end`, `agent_settled`, `cache_warming_decision` (handler returns `undefined`, body in try/catch), `session_shutdown`. The shutdown drain runs and is sent **before** the disconnect path in the same handler.
- A stop decision is itself a `cache_warming_decision`, so the last refresh's usage drains then.

### D3 — Server accumulation and synthesis
- `usage_recorded` → one accumulator used by both live paths. It adds input, output, cacheRead, cacheWrite and cost directly (not only via `turnUsage`), and synthesizes `stats_update{ usageKind, ... }`.
- The reducer appends a `TurnStat` only for turn kind; totals take every kind.

### D4 — Seeding and re-extraction
- On registration of a session whose file already has entries, seed totals from `extractSessionStats(file)` before live accumulation. Fresh sessions (no file yet) start at zero as today.
- `SessionMeta.statsExtractorVersion`: the scanner re-extracts when it is absent or older, regardless of mtime.

## Risks / Trade-offs

- [Live lag up to one idle refresh interval] → accepted; exact at shutdown.
- [SIGKILLed process leaves live short] → accepted; the next extractor-versioned re-extraction from JSONL corrects it.
- [Below-floor runtime (no usage entries / tool usage)] → nothing to count, nothing forwarded; no regression.
- [Seeding cost on registration of large files] → the same single-pass reader the scanner already uses; only for sessions with existing history.
