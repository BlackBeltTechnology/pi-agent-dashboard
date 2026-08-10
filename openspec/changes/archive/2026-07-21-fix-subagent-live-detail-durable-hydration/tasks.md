## 1. Reducer — durable live hydration (TDD)

- [x] 1.1 Add a failing reducer test: a `tool_execution_update` whose structured `partialResult.details` carry `{ agentId, agentSessionId, subagentType, status: "running", entries: [1 entry] }` with `toolName: "Agent"` ⇒ `state.subagents.get(agentId)` is defined, `status === "running"`, `entries.length === 1`, and `state.subagents.get(agentSessionId)` is the SAME reference. Verify RED (map empty before the fix).
- [x] 1.2 Add a no-regression test: `tool_execution_end` (completed) followed by a late running `tool_execution_update` for the same `agentId` ⇒ status stays `completed` (no regress).
- [x] 1.3 In `packages/client/src/lib/chat/event-reducer.ts` `tool_execution_update` structured-`partialResult` arm, after storing `toolDetails`, hydrate `next.subagents` from `details` when `next.messages[idx].toolName === "Agent"` and `details.agentId` is a string. Mirror the `tool_execution_end` Agent backfill: `readSubagentDetails(details)` + `setSubagentState()`, status `running`, with an `isTerminal` guard so a late partial never regresses a `completed`/`failed` state. Reuse existing helpers; add no new structure.
- [x] 1.4 Verify GREEN — both new tests pass.

## 2. Verify — no regressions

- [x] 2.1 Full reducer + subagents-plugin suites green (`event-reducer.test.ts` 185/185; combined 1341/1341).
- [x] 2.2 `event-reducer.ts` type-clean; Biome parity with the mirrored `tool_execution_end` arm (no new warnings).
- [x] 2.3 Manual: expand a running Agent subagent card mid-run and confirm the timeline hydrates (or shows "No detail available yet." running state) instead of "Subagent not found." **Verified live** on the deployed prod build via a dummy Explore subagent — mid-run card hydrated from the durable channel.

## 3. Deploy

- [x] 3.1 `npm run build` (production) + `POST /api/restart`; health confirmed `mode=production`, serving the new bundle.
