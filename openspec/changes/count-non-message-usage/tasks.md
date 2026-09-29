## 1. Offline totals

- [ ] 1.1 JSONL fixture tests first (usage entry incl. unknown kind and cache-read-only, compaction usage, branch-summary usage, tool-result usage, context gauge untouched), then implement in `session-stats-reader.ts` and `state-replay.ts`; verify tests pass
- [ ] 1.2 Add `statsExtractorVersion` to `SessionMeta`; `session-scanner.ts` re-extracts when absent or older; verify with the two `meta-json-session-cache` scenarios

## 2. Live totals

- [ ] 2.1 `protocol.ts`: `usage_recorded` forwarded event + `usageKind` on synthesized `stats_update`; one server accumulator in `event-wiring.ts` / `event-status-extraction.ts` counting all token fields and cost for every kind; verify with server accumulation and synthesis tests
- [ ] 2.2 Bridge: tool-result usage → `usage_recorded`; drain cursor keyed by session id with `getEntryCount()` guard at `turn_end` / `agent_settled` / `cache_warming_decision` (observe-only) / `session_shutdown` (before disconnect); verify with unit tests for the drain, session-id change, lazy session file and observe-only handler (nodejs-expert checkpoint)
- [ ] 2.3 Seed totals from `extractSessionStats` when registering a session whose file already has entries; verify with a fork fixture test
- [ ] 2.4 Reducer: `TurnStat` only for turn-kind `stats_update`; verify with the modified `event-reducer` "Stats accumulation" scenarios

## 3. Verification

- [ ] 3.1 Real session with cache warming enabled: idle through at least one refresh, run a codemode `models.classify()` call (`"defaultTools": ["+codemode"]`), compact, then shut down; verify live totals equal JSONL-derived totals and pi's `/session` cost, and the turn chart shows only real turns
- [ ] 3.2 Full suite green; update touched `AGENTS.md` rows with `See change: count-non-message-usage`; verify `openspec validate count-non-message-usage`

## 4. Scenario tests (from test-plan.md)

- [ ] 4.1 L1 test: derived cache-warm usage — see `packages/server/src/__tests__/session-scanner.test.ts` for JSONL fixture harness; `usage` `cache_warm` cacheRead 50000 cost 0.015 · `extractSessionStats` · both included (test-plan #E1)
- [ ] 4.2 L1 test: derived unknown usage kind — same exemplar; `kind:"future_kind"` · `extractSessionStats` · added (test-plan #E2)
- [ ] 4.3 L1 test: compaction + branch summary without gauge move — same exemplar; compaction 40000, branch summary, last assistant 12000 · `extractSessionStats` · totals include both, `lastTotalTokens` 12000 (test-plan #E3)
- [ ] 4.4 L1 test: tool-result usage once — see `packages/server/src/__tests__/event-status-extraction.test.ts`; tool-result usage repeated in `turn_end.toolResults` · live + derived · counted once each (test-plan #E4)
- [ ] 4.5 L1 test: server `usage_recorded` accumulation — see `packages/server/src/__tests__/event-status-extraction.test.ts`; cache_warm usage · server handling · totals updated, kind-marked `stats_update` synthesized (test-plan #E5)
- [ ] 4.6 L1 test: drained-only `turn_end` — see `packages/extension/src/__tests__/session-sync.test.ts` for bridge fakes; `turn_end` w/o usage + drained compaction · drain + server · only the compaction `stats_update` (test-plan #E6)
- [ ] 4.7 L1 test: drain cursor with lazy file and id change — see `packages/extension/src/__tests__/session-sync.test.ts`; fake manager entries, file appears, then id changes · drains · nothing skipped; history not forwarded after id change (test-plan #E7)
- [ ] 4.8 L1 test: `getEntryCount` guard — same exemplar; unchanged count · drain · `getEntries` not called (test-plan #E8)
- [ ] 4.9 L1 test: observe-only decision handler — same exemplar; decision `refresh`, throwing drain · handler · returns `undefined`, no throw (test-plan #E9)
- [ ] 4.10 L1 test: shutdown drain ordering — same exemplar; undrained entry · `session_shutdown` · `usage_recorded` sent before disconnect (test-plan #E10)
- [ ] 4.11 L1 test: seeding on registration with history — see `packages/server/src/__tests__/session-scanner.test.ts` + memory-session-manager tests; forked file with usage · register · seeded totals, later usage on top (test-plan #E11)
- [ ] 4.12 L1 reducer test: TurnStat only for turn kind — see `packages/client/src/lib/__tests__/event-reducer.test.ts`; unkinded vs `usage:cache_warm` `stats_update` · reducer · TurnStat appended only for the first (test-plan #E12)
- [ ] 4.13 L1 test: sidecar extractor version — see `packages/server/src/__tests__/session-scanner.test.ts`; versionless vs current sidecar · discovery · re-extract vs reuse (test-plan #E13)
- [ ] 4.14 Manual: real session live-vs-derived totals equal pi `/session` cost; chart shows only real turns (test-plan: manual-only, #F1)
