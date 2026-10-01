# Test Plan — count-non-message-usage

Stage: design   Generated: 2026-09-30

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | derived: cache-warm usage | EP | L1 | automated | JSONL with `usage` entry `kind:"cache_warm"`, `cacheRead:50000`, `cost.total:0.015` | `extractSessionStats` | cost includes `0.015`; cacheRead includes `50000` |
| E2 | derived: unknown kind | EP | L1 | automated | `usage` entry `kind:"future_kind"` with tokens + cost | `extractSessionStats` | tokens and cost added |
| E3 | derived: compaction + branch summary, gauge untouched | decision-table | L1 | automated | compaction entry `usage.totalTokens:40000`; branch summary with usage; last assistant `totalTokens:12000` | `extractSessionStats` | both usages in totals; `lastTotalTokens` = `12000` |
| E4 | tool-result usage counted once | EP | L1 | automated | turn whose tool-result message carries usage and whose `turn_end.toolResults` repeats it | live path + derived path | usage added exactly once on each path |
| E5 | server accumulation of `usage_recorded` | EP | L1 | automated | `usage_recorded {kind:"usage:cache_warm", usage:{cacheRead:50000, cost.total:0.015}}` | server handling | session totals cacheRead +50000, cost +0.015; synthesized `stats_update` with `usageKind:"usage:cache_warm"` |
| E6 | turn_end drained-only | EP | L1 | automated | `turn_end` without `message.usage`; a compaction usage drained at that boundary | bridge drain + server | a kind-marked `stats_update` for the compaction only; none for the turn |
| E7 | drain cursor and lazy file | state-transition | L1 | automated | fake session manager: entries appended, then file path appears (same session id), then session id changes | drain calls | pre-file usage forwarded; nothing skipped; after id change, pre-existing entries not forwarded |
| E8 | `getEntryCount` guard | EP | L1 | automated | entry count unchanged since last drain | drain | `getEntries()` not called |
| E9 | observe-only decision handler | EP | L1 | automated | `cache_warming_decision {action:"refresh"}`; drain throws | bridge handler | returns `undefined`; no throw escapes |
| E10 | shutdown drain before disconnect | state-transition | L1 | automated | undrained usage entry at `session_shutdown` | shutdown handler | `usage_recorded` sent before the disconnect call |
| E11 | seeding on registration with history | EP | L1 | automated | forked session file containing copied entries with usage | server registers session | initial totals = `extractSessionStats(file)`; later usage added on top |
| E12 | reducer TurnStat rule | decision-table | L1 | automated | `stats_update` without kind; with `usageKind:"usage:cache_warm"` | reducer | first appends a TurnStat; second updates totals only |
| E13 | sidecar extractor version | decision-table | L1 | automated | sidecar without `statsExtractorVersion` + JSONL not newer; sidecar with current version | scanner discovery | first re-extracts and updates version; second reuses cache |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | live equals derived | convergence | — | manual-only | real session with cache warming, codemode `classify()`, a compaction | idle through a refresh, shut down | [judgment vs pi `/session`: live totals equal JSONL totals and pi's cost; chart shows only real turns — needs real provider credentials] |

---

## Coverage summary

- Requirements covered: 6/6
- Scenarios by class: edge 13 · perf 0 · frontend 1 · error 0
- Scenarios by level: L1 13 · L2 0 · L3 0
- Scenarios by disposition: automated 13 · manual-only 1

## New infra needed

- none
