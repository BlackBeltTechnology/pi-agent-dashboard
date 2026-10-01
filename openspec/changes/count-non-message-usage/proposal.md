## Why

The dashboard computes session tokens and cost from assistant-message usage only:
- live: the server synthesizes `stats_update` from forwarded `turn_end` events (`event-wiring.ts:1196`);
- offline: `session-stats-reader.ts` / `state-replay.ts`.

pi also records model-attributed usage that is not an assistant message, and counts all of it in `/session`:
- `usage` session entries (cache warming, since 0.86);
- compaction and branch-summary `usage` (since 0.81);
- usage on tool-result messages (codemode nested calls and `models.classify()`, 0.99).

Cache warming is almost entirely cache-read tokens, so the undercount concentrates exactly where the dashboard's totals are least visible. Existing sessions also keep undercounted totals in `.meta.json` indefinitely.

Depends on `update-pi-core-0-99-adopt-apis`.

## What Changes

- **Offline:** JSONL extraction counts every usage kind, including cache read/write. Only assistant usage drives the context gauge. Sidecars record an extractor version, so pre-upgrade caches re-extract.
- **Live:**
  - The bridge forwards a new `usage_recorded` event, drained from session-manager entries via a per-session-id cursor at `turn_end`, `agent_settled`, `cache_warming_decision` (observe-only) and `session_shutdown` (before disconnect). Tool-result usage comes from the tool-result message.
  - The server accumulates it (all token fields and cost) and synthesizes a kind-marked `stats_update`.
  - A session registered with existing history seeds its totals from its JSONL.
- **Client:** non-turn `stats_update` adds to totals without appending a `TurnStat` (no chart bar, no eviction of real turns).

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `token-stats-pipeline`: new "Session totals include non-message usage", "A session registered with existing history starts from its derived totals", "Observing cache-warming decisions SHALL NOT influence them"; "Stats extraction from turn_end events" is corrected to server-side synthesis.
- `event-reducer`: "Stats accumulation" appends a `TurnStat` for turn-kind usage only.
- `meta-json-session-cache`: cached stats carry an extractor version.

## Impact

- **Code:**
  - extension: `bridge.ts` (drain cursor, `usage_recorded` forwarding, tool-result usage);
  - shared: `protocol.ts` (forwarded event + `stats_update` usage kind), `stats-extractor.ts`, `state-replay.ts`;
  - server: `event-wiring.ts` (accumulation + synthesis), `session/event-status-extraction.ts` `accumulateStats`, `session/session-stats-reader.ts`, `session/session-scanner.ts` (extractor version), session registration seeding (`memory-session-manager.ts`);
  - client: `event-reducer.ts` (`TurnStat` kind rule), `TokenStatsBar.tsx` (unchanged input shape).
- **Tests:** JSONL fixtures for every kind; bridge drain and cursor tests; server accumulation and synthesis tests; reducer and sidecar re-extraction tests.
- **Rollback:** revert. Sidecars with a newer extractor version are simply re-extracted by the old build's mtime rule, so they are harmless.

## Discipline Skills

`review-code` · `observability-instrumentation` (cost numbers users rely on; live-vs-derived agreement check) · `performance-optimization` (drain on long sessions: `getEntryCount()` guard before `getEntries()` copies).

Subagent checkpoints (not skills): `nodejs-expert` (new bridge drain + forwarded-event path across extension and server).
