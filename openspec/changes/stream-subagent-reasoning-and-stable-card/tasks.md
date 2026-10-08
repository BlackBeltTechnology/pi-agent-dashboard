## 1. Producer (../pi-dashboard-subagents)

- [x] 1.1 Write failing tests in extensions/__tests__/agent.test.ts (exemplar: existing text_delta burst test): tail is bounded at 0/1/279/280/281/1000-char thinking deltas, tail length = min(total,280) suffix with kind thinking (test-plan #E1)
- [x] 1.2 Write failing test in extensions/__tests__/agent.test.ts: text block then thinking block, ticks show kind text then none then thinking, never mixed (test-plan #E2)
- [x] 1.3 Write failing test in extensions/__tests__/agent.test.ts: every snapshot kind (queued, running mid-block, running idle, completed, failed, aborted, early-error) carries liveTail, non-streaming ones equal the cleared sentinel (test-plan #E3)
- [x] 1.4 Write failing test in extensions/__tests__/agent.test.ts: tool start then tool end, the tick after tool end keeps activity "running <tool>" (test-plan #E4)
- [x] 1.5 Write failing test in extensions/__tests__/agent.test.ts (exemplar: text_delta burst test): 100 thinking_delta in under 250 ms, emitted ticks at most ceil(burst/250ms)+1 (test-plan #P2)
- [x] 1.6 Implement liveTail accumulation from thinking_delta/text_delta in snapshotDetails, always present, cleared sentinel when idle; stop clearing activity on tool_execution_end
- [x] 1.7 CHANGELOG, extensions/AGENTS.md row, release 0.2.7 Done: shipped in pi-dashboard-subagents 0.3.0 (liveTail + thinkingLevel commit 0ed01ae), released together with the entry stream instead of a separate 0.2.7.

## 2. Dashboard wire + state

- [x] 2.1 Write failing test in packages/extension/src/__tests__/subagent-frame-strip.test.ts (exemplar: same file): running frame with entries and liveTail, strip removes entries, keeps liveTail deep-equal, input not mutated (test-plan #E5)
- [x] 2.2 Write failing test in packages/extension/src/__tests__/subagent-tick-growth.test.ts (exemplar: same file): timeline 10 to 100 entries with a 280-char tail, serialized bytes at 100 at most 2x those at 10 (test-plan #P1)
- [x] 2.3 Write failing test in packages/client/src/lib/__tests__/thin-subagent-frame-reducer.test.ts (exemplar: same file): fold valid thinking/text tail, sentinel, invalid kind, non-string text, 400-char text, state equals valid tail or cleared tail, text truncated to 280, no throw (test-plan #E6)
- [x] 2.4 Write failing test in packages/client/src/lib/__tests__/thin-subagent-frame-reducer.test.ts: liveTail as string, null, array, non-object ignored, previous state kept, no throw (test-plan #X3)
- [x] 2.5 Write failing test in packages/server/src/__tests__/memory-event-store.test.ts (exemplar: existing subsumption tests): 3 tail-to-clear blocks plus terminal, each clear subsumes its predecessor, raw and compacted folds yield identical SessionState with cleared tail (test-plan #X1)
- [x] 2.6 Implement liveTail reader in readSubagentDetails (normalize, never reject) and add liveTail to SubagentState and AgentToolRenderer details types

## 3. Dashboard UI

- [x] 3.1 Write failing test in packages/client/src/components/tool-renderers/__tests__/AgentToolRenderer.test.tsx (exemplar: same file): running details alternating activity on/off and tail on/off, activity and preview rows always mounted with identical fixed-height classes (test-plan #F1)
- [x] 3.2 Write failing test in packages/client/src/components/tool-renderers/__tests__/AgentToolRenderer.test.tsx: card showing tail abc, then a subagents:started resync frame with the cleared tail, preview row is empty (test-plan #F3)
- [x] 3.3 Write failing test in packages/client/src/components/tool-renderers/__tests__/AgentToolRenderer.test.tsx and packages/subagents-plugin/src/client/__tests__/SubagentDetailView.test.tsx: 0.2.6-shaped details without liveTail, no error, empty fixed-height preview row, inspector unchanged (test-plan #X2)
- [x] 3.4 Write failing tests in packages/client-utils/src/minimal-chat/__tests__/MinimalChatView.test.tsx and packages/subagents-plugin/src/client/__tests__/SubagentDetailView.test.tsx (exemplar: same files): entries 0 or 3 crossed with tail none/thinking/text, live entry last and labelled in progress when tail non-empty, empty state only when entries 0 and tail none (test-plan #E7)
- [x] 3.5 Implement fixed-height activity row and clamped preview row in AgentToolRenderer running branch, reading session.subagents tail before toolDetails
- [x] 3.6 Implement MinimalChatView liveEntry prop (counts as body content) and map liveTail in SubagentDetailView
- [x] 3.7 Extend tests/e2e/subagent-inspector.spec.ts (exemplar: same file): faux subagent streaming tool calls and thinking for at least 5 s, collapsed card boundingBox height identical across all samples while running (test-plan #F2) Spec written in tests/e2e/subagent-inspector.spec.ts; its harness run is the PR CI e2e workflow (local docker harness skipped by user choice; the :8000 preview serves this build).

## 5. Thinking level on the card (added during apply)

- [x] 5.1 Write failing tests in ../pi-dashboard-subagents extensions/__tests__/agent.test.ts: running/completed snapshots carry thinkingLevel equal to session.thinkingLevel; fall back to the requested level when the session exposes none
- [x] 5.2 Implement details.thinkingLevel in the producer (events.ts AgentDetails/buildDetails, agent.ts after createAgentSession); CHANGELOG line
- [x] 5.3 Write failing tests: reducer reads thinkingLevel (string kept, non-string ignored); AgentToolRenderer stats line shows "thinking high" after the model and omits it when absent; SubagentDetailView header shows the level
- [x] 5.4 Implement SubagentState.thinkingLevel, the readSubagentDetails reader, the buildStats segment and the inspector meta label

## 6. Tail hand-off + main-chat styling (added during apply)

- [x] 6.1 Live entry and card preview reuse main-chat styles (ThinkingBlock rail/tint/cursor; streaming-bubble classes); card preview is a block element
- [x] 6.2 Hold the last tail until the finished entry arrives (inspector) or the next block or terminal (card); no extra resync on clear (A/B: rejected, see 7.1)
- [x] 6.3 Newest reasoning entry mounts expanded while running (`expandLastThinking`)

## 7. Card option C + perf A (added during apply)

- [x] 7.1 A/B the storage strategies on the real store (mockups/perf-and-replay.html); drop the clear-edge resync (A)
- [x] 7.2 Card option C: one fixed h-4 row with kind icon + `currentSentence` ticker (left-fade on overflow), activity otherwise
- [x] 7.3 Inspector live block per mock: reasoning header, 13px body, line breaks kept, top fade mask, markdown stripped for writing (`plainTail`)

## 4. Docs + manual

- [x] 4.1 Update AGENTS.md rows for touched files
- [ ] 4.2 Manual check: running subagent preview reads like main-chat thinking with no jitter (test-plan: manual-only, #F4)
