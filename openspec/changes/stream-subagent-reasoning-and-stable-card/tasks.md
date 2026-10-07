## 1. Producer (../pi-dashboard-subagents)

- [ ] 1.1 Write failing tests in extensions/__tests__/agent.test.ts (exemplar: existing text_delta burst test): tail is bounded at 0/1/279/280/281/1000-char thinking deltas, tail length = min(total,280) suffix with kind thinking (test-plan #E1)
- [ ] 1.2 Write failing test in extensions/__tests__/agent.test.ts: text block then thinking block, ticks show kind text then none then thinking, never mixed (test-plan #E2)
- [ ] 1.3 Write failing test in extensions/__tests__/agent.test.ts: every snapshot kind (queued, running mid-block, running idle, completed, failed, aborted, early-error) carries liveTail, non-streaming ones equal the cleared sentinel (test-plan #E3)
- [ ] 1.4 Write failing test in extensions/__tests__/agent.test.ts: tool start then tool end, the tick after tool end keeps activity "running <tool>" (test-plan #E4)
- [ ] 1.5 Write failing test in extensions/__tests__/agent.test.ts (exemplar: text_delta burst test): 100 thinking_delta in under 250 ms, emitted ticks at most ceil(burst/250ms)+1 (test-plan #P2)
- [ ] 1.6 Implement liveTail accumulation from thinking_delta/text_delta in snapshotDetails, always present, cleared sentinel when idle; stop clearing activity on tool_execution_end
- [ ] 1.7 CHANGELOG, extensions/AGENTS.md row, release 0.2.7

## 2. Dashboard wire + state

- [ ] 2.1 Write failing test in packages/extension/src/__tests__/subagent-frame-strip.test.ts (exemplar: same file): running frame with entries and liveTail, strip removes entries, keeps liveTail deep-equal, input not mutated (test-plan #E5)
- [ ] 2.2 Write failing test in packages/extension/src/__tests__/subagent-tick-growth.test.ts (exemplar: same file): timeline 10 to 100 entries with a 280-char tail, serialized bytes at 100 at most 2x those at 10 (test-plan #P1)
- [ ] 2.3 Write failing test in packages/client/src/lib/__tests__/thin-subagent-frame-reducer.test.ts (exemplar: same file): fold valid thinking/text tail, sentinel, invalid kind, non-string text, 400-char text, state equals valid tail or cleared tail, text truncated to 280, no throw (test-plan #E6)
- [ ] 2.4 Write failing test in packages/client/src/lib/__tests__/thin-subagent-frame-reducer.test.ts: liveTail as string, null, array, non-object ignored, previous state kept, no throw (test-plan #X3)
- [ ] 2.5 Write failing test in packages/server/src/__tests__/memory-event-store.test.ts (exemplar: existing subsumption tests): 3 tail-to-clear blocks plus terminal, each clear subsumes its predecessor, raw and compacted folds yield identical SessionState with cleared tail (test-plan #X1)
- [ ] 2.6 Implement liveTail reader in readSubagentDetails (normalize, never reject) and add liveTail to SubagentState and AgentToolRenderer details types

## 3. Dashboard UI

- [ ] 3.1 Write failing test in packages/client/src/components/tool-renderers/__tests__/AgentToolRenderer.test.tsx (exemplar: same file): running details alternating activity on/off and tail on/off, activity and preview rows always mounted with identical fixed-height classes (test-plan #F1)
- [ ] 3.2 Write failing test in packages/client/src/components/tool-renderers/__tests__/AgentToolRenderer.test.tsx: card showing tail abc, then a subagents:started resync frame with the cleared tail, preview row is empty (test-plan #F3)
- [ ] 3.3 Write failing test in packages/client/src/components/tool-renderers/__tests__/AgentToolRenderer.test.tsx and packages/subagents-plugin/src/client/__tests__/SubagentDetailView.test.tsx: 0.2.6-shaped details without liveTail, no error, empty fixed-height preview row, inspector unchanged (test-plan #X2)
- [ ] 3.4 Write failing tests in packages/client-utils/src/minimal-chat/__tests__/MinimalChatView.test.tsx and packages/subagents-plugin/src/client/__tests__/SubagentDetailView.test.tsx (exemplar: same files): entries 0 or 3 crossed with tail none/thinking/text, live entry last and labelled in progress when tail non-empty, empty state only when entries 0 and tail none (test-plan #E7)
- [ ] 3.5 Implement fixed-height activity row and clamped preview row in AgentToolRenderer running branch, reading session.subagents tail before toolDetails
- [ ] 3.6 Implement MinimalChatView liveEntry prop (counts as body content) and map liveTail in SubagentDetailView
- [ ] 3.7 Extend tests/e2e/subagent-inspector.spec.ts (exemplar: same file): faux subagent streaming tool calls and thinking for at least 5 s, collapsed card boundingBox height identical across all samples while running (test-plan #F2)

## 4. Docs + manual

- [ ] 4.1 Update AGENTS.md rows for touched files
- [ ] 4.2 Manual check: running subagent preview reads like main-chat thinking with no jitter (test-plan: manual-only, #F4)
