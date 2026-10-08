## Why

The dashboard computes session tokens and cost from assistant-message usage only:
- live: the server synthesizes `stats_update` from forwarded `turn_end` events (`packages/server/src/event-wiring.ts:1206-1241`);
- offline: `session-stats-reader.ts` / `state-replay.ts`;
- hydration: opening an ended session REPLACES its totals with `extractStatsFromEvents(replayed events)` (`packages/server/src/browser-handlers/subscription-handler.ts:1029-1039`), so replay is a third totals path.

pi also records model-attributed usage that is not an assistant message, and counts all of it in `/session`:
- `usage` session entries (cache warming, since 0.86);
- compaction and branch-summary `usage` (since 0.81);
- usage on tool-result messages (since 0.81; codemode `models.classify()` since 0.99, `models.generateImages()` since 1.0.0).

Cache warming is almost entirely cache-read tokens, so the undercount concentrates exactly where the dashboard's totals are least visible. Existing sessions also keep undercounted totals in `.meta.json` indefinitely.

Depends on `update-pi-core-1-0-adopt-apis`.

## What Changes

- **Offline:** JSONL extraction counts every usage kind, including cache read/write. Only assistant usage drives the context gauge. Sidecars record an extractor version, so pre-upgrade caches of non-archived sessions re-extract.
- **Replay:** `replayEntriesAsEvents` also synthesizes a kind-marked `stats_update` for every non-assistant usage source, so hydration no longer overwrites corrected totals with undercounted ones.
- **Live:**
  - Tool-result usage: the server reads it from the already-forwarded `message_end` with `role: "toolResult"` (no new bridge path; assistant `message_end` is never counted).
  - Entry usage (`usage`, `compaction`, `branch_summary`): the bridge forwards a new `usage_recorded` event, drained from `ctx.sessionManager.getEntries()` past a cursor holding the last forwarded entry id, at `turn_end`, `agent_settled`, `cache_warming_decision` (observe-only) and `session_shutdown` (before `session_unregister`, which pi also runs on fork/new/resume/reload).
  - Baseline + seed share one snapshot: on bridge init/reload and on session change the bridge sets the cursor to the current end and sends the snapshot's full totals as `usageSeed` on `session_register`. Reconnect leaves the cursor alone.
  - The server accumulates both live sources (all token fields and cost) and synthesizes a kind-marked `stats_update` carrying `turnUsage`.
  - The server applies `usageSeed` only for an id it has no record of (fork, switch to an unscanned file). Known ids keep today's preserve-on-register behaviour.
- **Client:** non-turn `stats_update` adds to totals (including cache) without appending a `TurnStat`, assigning a `turnIndex` or bumping `turnCount`.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `token-stats-pipeline`: new "Session totals include non-message usage", "A session id first seen with existing history starts from its seeded totals", "Observing cache-warming decisions SHALL NOT influence them"; "Stats extraction from turn_end events" and "Server-side token accumulation" corrected to server-side synthesis from all live sources.
- `catch-all-event-forwarding`: `cache_warming_decision` joins the control events (dedicated drain handler, never `event_forward`).
- `server-side-event-processing`: "Server-side stats extraction from forwarded turn_end events" extended to tool-result `message_end` and `usage_recorded`.
- `event-reducer`: "Stats accumulation" — turn bookkeeping (`TurnStat`, `turnIndex`, `turnCount`) for turn-kind usage only; totals for every kind.
- `token-stats-bar`: "Turn index on TurnStat and messages" restricted to turn-kind `stats_update`.
- `meta-json-session-cache`: cached stats of non-archived sessions carry an extractor version; the persisted-`contextWindow` rule covers every re-extract trigger.
- `on-demand-session-replay`: replay synthesizes kind-marked `stats_update` for non-message usage; the `contextWindow` override applies to events carrying `contextUsage`.

Non-goals: per-kind cost UI; changing pi's cache warming; abandoned-branch usage in branch-replayed views (hydration, `TokenStatsBar`), as today; deduplicating usage that is undrained when the server re-derives totals from JSONL (restart, hydration) — a bounded double count of at most one drain interval, corrected at the next re-extraction (same class as outage-buffered `turn_end` today).

## Impact

- **Code:**
  - extension: `bridge.ts` (entry-id drain cursor, `usage_recorded` forwarding), `session-sync.ts` (baseline + `usageSeed` on register / session change);
  - shared: `protocol.ts` (`usage_recorded` forwarded event, `usageKind` on `stats_update`, optional `usageSeed` on `session_register`), a pure entry-usage summing helper, `stats-extractor.ts` (tool-result usage), `state-replay.ts` (non-message stats synthesis);
  - server: `event-wiring.ts` (accumulation + synthesis for `usage_recorded` and tool-result `message_end`), `session/session-stats-reader.ts`, `session/session-scanner.ts` + `session/session-to-meta.ts` (extractor version), `session/memory-session-manager.ts` (seed for unknown ids);
  - client: `event-reducer.ts` (turn-kind gate), `TokenStatsBar.tsx` (unchanged input shape).
  - `session/event-status-extraction.ts` `extractStatsFromEvents` unchanged: non-turn events carry `turnUsage`.
- **Compatibility:** `usageSeed` and `usage_recorded` are additive; an older bridge sends neither and the server behaves as today (plus tool-result usage from `message_end`). Against an older server neither is counted.
- **Tests:** JSONL fixtures for every kind; replay fixtures; bridge drain, baseline and seed tests; server accumulation, synthesis and seeding tests; reducer and sidecar re-extraction tests.
- **Rollback:** revert. An old build ignores `statsExtractorVersion` and keeps the sidecar's newer, fuller totals until the JSONL mtime advances, then re-extracts the old (undercounting) way. No data loss; totals regress to today's undercount.

## Discipline Skills

`review-code` · `observability-instrumentation` (cost numbers users rely on; live-vs-derived agreement check) · `performance-optimization` (drain on long sessions: one `getEntries()` copy per drain point, measured on a large fixture).

Subagent checkpoints (not skills): `nodejs-expert` (new bridge drain + forwarded-event path across extension and server).
