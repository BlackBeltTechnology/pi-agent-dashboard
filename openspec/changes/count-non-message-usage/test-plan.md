# Test Plan — count-non-message-usage

Stage: design   Generated: 2026-10-01

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | token-stats-pipeline: Session totals include non-message usage (cache-warm) | EP | L1 | automated | JSONL with `usage` entry `kind:"cache_warm"`, `cacheRead:50000`, `cost.total:0.015` | `extractSessionStats` | cost includes `0.015`; cacheRead includes `50000` |
| E2 | token-stats-pipeline: unknown kind | EP | L1 | automated | `usage` entry `kind:"future_kind"`, `input:100`, `output:20`, `cost.total:0.002` | `extractSessionStats` | tokensIn +100, tokensOut +20, cost +0.002 |
| E3 | token-stats-pipeline: compaction + branch summary, gauge untouched | decision-table | L1 | automated | compaction `usage.totalTokens:40000`; branch summary with usage; last assistant `totalTokens:12000` | `extractSessionStats` | both usages in totals; `lastTotalTokens` = `12000` |
| E4 | token-stats-pipeline: tool-result usage counted once | decision-table | L1 | automated | tool-result message with `usage.input:300`, repeated in `turn_end.toolResults`; same message as a JSONL message entry | live: forwarded tool-result `message_end` then `turn_end`; derived: `extractSessionStats` | live tokensIn +300 exactly once; derived tokensIn +300 exactly once |
| E5 | token-stats-pipeline: assistant `message_end` not counted | EP | L1 | automated | assistant `message_end` with `usage.input:1000`, then its `turn_end` | server handling of both | tokensIn +1000 once; one `stats_update` (from `turn_end`) |
| E6 | token-stats-pipeline: Server-side token accumulation; server-side-event-processing: kind-marked synthesis | EP | L1 | automated | `usage_recorded {kind:"usage:cache_warm", usage:{cacheRead:50000, cost.total:0.015}}` | server handling | session cacheRead +50000, cost +0.015; stored + broadcast `stats_update` with `usageKind:"usage:cache_warm"`, `turnUsage.cacheRead:50000`, no `contextUsage` |
| E7 | token-stats-pipeline: drain allowlist | decision-table | L1 | automated | fake manager: after baseline append a `usage` entry (with provider/model), a compaction with usage, a branch summary with usage, a compaction without usage, a toolResult message entry with usage | drain at `turn_end` | exactly 3 `usage_recorded`; `usage` one carries provider/model, the others omit them; message entry not forwarded |
| E8 | token-stats-pipeline: baseline + seed share one snapshot (reload) | state-transition | L1 | automated | fake manager with 5 history entries incl. assistant, `usage` and compaction usage | bridge init (incl. reload re-init) | no `usage_recorded`; `session_register.usageSeed` equals the snapshot's full totals of every kind |
| E9 | token-stats-pipeline: shared summing helper agrees | EP | L1 | automated | one fixture of every kind, as entries and as JSONL | `usageSeed` helper vs `extractSessionStats` | identical tokensIn/tokensOut/cacheRead/cacheWrite/cost |
| E10 | token-stats-pipeline: lazy session file is not a session switch | state-transition | L1 | automated | fake manager: entries appended with no file, then `getSessionFile()` starts returning a path, same `getSessionId()` | drains before and after the file appears | every usage entry forwarded exactly once; none skipped |
| E11 | token-stats-pipeline: fork drains outgoing session, then baselines | state-transition | L1 | automated | undrained `usage` entry on session A; fork to B whose snapshot holds copied entries | `session_shutdown{reason:"fork"}` on A, then `session_start{reason:"fork"}` | A's `usage_recorded` sent before A's `session_unregister`; B registers with `usageSeed` = B snapshot totals; copied entries not forwarded |
| E12 | token-stats-pipeline: usage right after a fork not lost | state-transition | L1 | automated | B registered and baselined; then a `usage` entry appended to B | next drain point (`agent_settled`) | that entry forwarded once for B |
| E13 | token-stats-pipeline: cursor id vanished | state-transition | L1 | automated | cursor `lastEntryId` absent from the next `getEntries()` snapshot | drain | nothing forwarded; cursor set to snapshot's last id; no `usageSeed` resent |
| E14 | token-stats-pipeline: reconnect keeps the cursor | state-transition | L1 | automated | connection drops; a `usage` entry is appended; connection restored | next drain point | entry forwarded exactly once; no re-baseline on reconnect |
| E15 | token-stats-pipeline: shutdown drain before unregister | state-transition | L1 | automated | undrained `usage` entry at `session_shutdown{reason:"quit"}` | shutdown handler | `usage_recorded` send precedes `session_unregister` send |
| E16 | token-stats-pipeline: Observing cache-warming decisions; catch-all-event-forwarding: control event | EP | L1 | automated | `cache_warming_decision {action:"warm"}`; drain stubbed to throw | bridge handler | returns `undefined`; no throw escapes; no `event_forward` with `eventType:"cache_warming_decision"` sent |
| E17 | token-stats-pipeline: seeded totals for a first-seen id | decision-table | L1 | automated | (a) unknown id + `usageSeed` all five fields set; (b) known id with totals + different `usageSeed`; (c) unknown id, no `usageSeed` | `memorySessionManager.register` | (a) totals = seed (cacheRead/cacheWrite included); (b) carried-over totals, seed ignored; (c) all five totals 0 |
| E18 | token-stats-pipeline: register-time replay adds no usage | EP | L1 | automated | history with tool-result message carrying usage and a `usage` entry, replayed via `replayEntriesAsEvents` and forwarded on register | server ingests replayed events | session totals unchanged; replay contains `tool_execution_end`, no tool-result `message_end` |
| E19 | event-reducer: Stats accumulation; token-stats-bar: Turn index | decision-table | L1 | automated | last user message without `turnIndex`; `stats_update` with `usageKind:"usage:cache_warm"`, `turnUsage.cacheRead:50000`; then one without kind | reducer | first: cacheRead +50000, `turnStats`/`turnCount`/`turnIndex` unchanged; second: TurnStat appended, user message `turnIndex = turnCount`, `turnCount` +1 |
| E20 | on-demand-session-replay: Replay synthesizes stats for non-message usage | EP | L1 | automated | single-branch entries: assistant (usage), `cache_warm` usage entry, compaction with usage, branch summary with usage, tool result with usage | `replayEntriesAsEvents(id, entries, 1_000_000)` | 4 kind-marked `stats_update` without `contextUsage`; `extractStatsFromEvents(events)` totals = `extractSessionStats` totals of the same fixture; last `contextUsage` is the assistant's, with `contextWindow: 1_000_000` |
| E21 | meta-json-session-cache: Cached stats carry an extractor version | decision-table | L1 | automated | (a) non-archived sidecar without version, JSONL not newer; (b) sidecar with current version, JSONL not newer; (c) archived sidecar without version | scanner discovery | (a) re-extracted, sidecar gets current version; (b) cached totals reused, JSONL not read; (c) JSONL not opened |
| E22 | meta-json-session-cache: version-triggered re-extract keeps contextWindow | EP | L1 | automated | sidecar without version, `model` claude-sonnet-4, `contextWindow:1_000_000`; JSONL not newer | scanner re-extract | resulting `contextWindow` = `1_000_000` |
| E23 | meta-json-session-cache: version survives a routine save | EP | L1 | automated | session record carrying current `statsExtractorVersion` | `sessionToMeta` full-overwrite save | rewritten sidecar still carries that version |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D2 drain budget | tail-latency (timed) | L1 | automated | fake session manager with 10,000 entries, cursor at last entry, no new entries | drain p95 ≤ 5 ms | 200 runs |
| P2 | design Risks: first-boot re-extract | measurement | — | manual-only | real session directory, all non-archived sidecars without version | [judgment: duration measured and reported at verification; no gate set] | one server start |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | token-stats-pipeline: live equals derived at shutdown | convergence | — | manual-only | real session with cache warming, codemode `models.classify()`, a compaction | idle through a refresh, shut down | [judgment vs pi `/session`: live totals equal JSONL totals and pi's cost; chart shows only real turns — needs real provider credentials] |

---

## Coverage summary

- Requirements covered: 12/12 (token-stats-pipeline ×5, server-side-event-processing, event-reducer, token-stats-bar, meta-json-session-cache ×2, on-demand-session-replay ×2, catch-all-event-forwarding)
- Scenarios by class: edge 23 · perf 2 · frontend 1 · error 0
- Scenarios by level: L1 24 · L2 0 · L3 0 · manual 2
- Scenarios by disposition: automated 24 · manual-only 2

## New infra needed

- none
