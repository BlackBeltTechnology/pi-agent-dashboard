## 1. Cross-version verification (correctness gate — design D1)

- [ ] 1.1 `npm pack @blackbelt-technology/pi-dashboard-subagents@<v>` for every published version (`npm view … versions --json`, currently 0.2.0–0.2.4) into a tmp dir and extract; verify five `extensions/agent.ts` + `extensions/events.ts` pairs are on disk
- [ ] 1.2 For each version diff `snapshotDetails`, `buildDetails`, `activityFromEvent`, `pushUpdate`, and the `completed`/`error`/`aborted` return paths; record per version in `openspec/changes/drop-final-update-on-tool-execution-end/verification.md`: (a) same key set modulo `undefined`, (b) keys that can be absent-on-end/present-on-tail, (c) any key whose JS type differs, (d) any same-key-same-type value that is semantically reset on the end (the only blocking finding). Verify the file has one section per version with all four items filled (test-plan X1, manual-only)
- [ ] 1.3 Live capture on the installed version: spawn one Agent via the dashboard, dump the stored `tool_execution_update` tail and `tool_execution_end` for its `toolCallId` (e.g. `GET /api/session/:id/events` filtered by `toolCallId`), apply the D2 gate by hand, and append the result + which key (if any) blocked the drop + the measured drop rate to `verification.md`. Verify the recorded wire shape matches 1.2's source read for that version (test-plan X2, manual-only)
- [ ] 1.4 Decide from 1.2(d): if any version has a blocking finding, stop — set `verification.md` status to "tail retained; do not re-propose on this reasoning" and mark tasks 2–4 not applicable; otherwise set status to "gate sound for 0.2.0–0.2.4, proceed". Verify the status line exists

## 2. End-side gate (design D2) — TDD, red first

Exemplar for every 2.x test: the existing `subsumes` unit tests X1–X9 in `packages/server/src/__tests__/memory-event-store.test.ts` (export the end-side gate under a test-only name the same way `subsumes` is). Each is one `it()`; write all red, verify they fail, then implement 2.15.

- [ ] 2.1 E1 nominal drop: tail `partialResult.details = {agentId:"a1", status:"running", tokensUsage:{…}, activity:"x"}` with `content`; end `data.details` same keys/types, `toolName:"Agent"`, `agentId:"a1"`, `result:"done"` → gate called → returns `true` (test-plan E1)
- [ ] 2.2 E2 key missing: tail has `activity:"writing"`, end `details` lacks it → gate → `false` (test-plan E2)
- [ ] 2.3 E3 type differs: tail `tokensUsage` object, end `tokensUsage: 42` → gate → `false` (test-plan E3)
- [ ] 2.4 E4 result implication: tail `partialResult.content` yields text; end `result: ""` → gate → `false` (test-plan E4)
- [ ] 2.5 E5 plain-string: tail `partialResult:"chunk"`; end no `details`, `result:"out"` → gate → `true` (test-plan E5)
- [ ] 2.6 E6 presence: tail `details:{agentId:"a1"}`; end no `details`, `result:"out"` → gate → `false` (test-plan E6)
- [ ] 2.7 E7 presence truthy-empty: tail `details:{}`; end no `details`, `result:"out"` → gate → `false` (test-plan E7)
- [ ] 2.8 E8 presence truthy non-object: tail `details:"text"`; end no `details`, `result:"out"` → gate → `false` (test-plan E8)
- [ ] 2.9 E9 invalid end details: end `details: null` and end `details: []` (two cases), `result:"done"` → gate → `false` both (test-plan E9)
- [ ] 2.10 E10 identity toolName/agentId: tail `agentId:"a1"`; end ⊇ tail but (a) `toolName` absent, (b) `toolName:"bash"`, (c) `agentId:"a2"` → gate ×3 → `false` ×3 (test-plan E10)
- [ ] 2.11 E11 identity agentSessionId: tail `agentSessionId:"s1"`, end `agentSessionId:"s2"` → gate → `false` (test-plan E11)
- [ ] 2.12 E12 identity absent-then-present: tail no `agentSessionId`, end adds `"s1"` → gate → `true` (test-plan E12)
- [ ] 2.13 E13 entries: tail `entries:[e1]`, end `entries:[]` → gate → `false` (test-plan E13)
- [ ] 2.14 Verify 2.1–2.13 fail before implementation (`npx vitest run packages/server/src/__tests__/memory-event-store.test.ts`)
- [ ] 2.15 Refactor `subsumes(p, s)` into `subsumesDetails(pd, sd, pSetsResult, sSetsResult)` (existing `keysSurvive`/`entriesSurvive`/result rule verbatim) plus the unchanged update-path wrapper; add the end-side resolver (`data.details` plain object else `undefined`; `Boolean(data.result)`), the presence rule (tail `partialResult.details` truthy ∧ end resolves none ⇒ false) and the identity rule (tail `agentId` string ⇒ end `toolName === "Agent"` ∧ equal `agentId` ∧ equal `agentSessionId` when the tail has one). Verify 2.1–2.13 pass
- [ ] 2.16 E14 regression: existing X1–X9 in the same file → run after the refactor → pass with zero fixture edits (test-plan E14)

## 3. Store hook (design D3/D4) — TDD, red first

Exemplar for every 3.x test: the `collapse of superseded tool_execution_update events` describe in `packages/server/src/__tests__/memory-event-store.test.ts` (store construction, `insertEvent`, `getEvents`, `getTrimStats`, small `maxEventsPerSession` for trim cases). Write all red, verify they fail, then implement 3.13.

- [ ] 3.1 S1 drop: store `[creating tick(agentId), tail]` for `tc1` → insert subsuming end (E1 shape) → tail seq absent from `getEvents`; tick + end present; `getTrimStats().collapsedUpdates` +1; index `newestSeq === creatingSeq` (test-plan S1)
- [ ] 3.2 S2 retain: same store → insert non-subsuming end (E2 shape) → all three present; counter unchanged (test-plan S2)
- [ ] 3.3 S3 tail is pin: store `[creating tick]` only → subsuming end → nothing dropped; counter unchanged (test-plan S3)
- [ ] 3.4 S4 pin trimmed: `maxEventsPerSession` small enough that a trim evicts the creating tick (`pruneCollapseIndex` releases `creatingSeq`), tail resident → subsuming end → tail RETAINED; counter unchanged (test-plan S4)
- [ ] 3.5 S5 no toolCallId: end with `toolCallId` absent → no throw; nothing dropped (test-plan S5)
- [ ] 3.6 S6 unknown call: subsuming end for `toolCallId:"other"` → no throw; nothing dropped (test-plan S6)
- [ ] 3.7 S7 tail already trimmed: index `newestSeq` points at a trimmed event → subsuming end → no throw; nothing dropped; counter unchanged (test-plan S7)
- [ ] 3.8 S8 late update after drop + prune: after S1 drop, force a trim so `pruneCollapseIndex` runs, then insert late `tool_execution_update` for `tc1` → entry survived prune; late update retained; creating tick still present and NOT re-pinned to the late update (test-plan S8)
- [ ] 3.9 S9 truncated end: end exceeding `maxEventDataSize` that is not a subagent timeline (becomes `{__truncated}`) → insert → no drop; no throw (test-plan S9)
- [ ] 3.10 S10 end never a candidate: insert TWO subsuming ends for `tc1` → neither end removed; counter +1 total (test-plan S10)
- [ ] 3.11 S11 counter shape: after a subsuming end, `getTrimStats()` → `collapsedUpdates` reflects it and no new counter key exists (test-plan S11)
- [ ] 3.12 Verify 3.1–3.11 fail before implementation
- [ ] 3.13 Implement `collapseOnEnd(buf, stored)` per D3 (lookup entry, require resident pin `creatingSeq !== undefined`, skip pin, `dropIfSuperseded` with the end-side gate, set `entry.newestSeq = entry.creatingSeq` on drop — NOT `undefined`, which `pruneCollapseIndex` deletes) and call it from `insertEvent` immediately after `collapseSuperseded`; give `dropIfSuperseded` a gate parameter rather than duplicating the verified-removal body. Verify 3.1–3.11 pass and the whole file is green
- [ ] 3.14 Update the header comment block `Superseded tool_execution_update collapse (D5/D6/D7)` and the `TrimStats.collapsedUpdates` doc comment to state the end-triggered drop, with `See change: drop-final-update-on-tool-execution-end`. Verify by reading the two comments

## 4. Replay equivalence (design D5)

Exemplar for every 4.x test: the existing fixture-stream cases in `packages/server/src/__tests__/collapse-replay-equivalence.test.ts` (fold ORIGINAL vs STORE-RETAINED through the client reducer; the local `selectRetained` mirror + store cross-check). End fixtures carry `toolName: "Agent"` as pi core does.

- [ ] 4.1 F1 Agent completed: `[start, creating tick, tail, end ⊇ tail]` → fold both → tail dropped AND `messages[idx].{result,toolDetails,toolStatus}` deep-equal AND `subagents.get(agentId)` + `subagents.get(agentSessionId)` deep-equal (test-plan F1)
- [ ] 4.2 F2 Agent failed: end `isError:true`, `details.error:"boom"` → fold both → tail dropped; states equal (test-plan F2)
- [ ] 4.3 F3 activity cleared: tail has `activity`, end lacks it → fold both → tail RETAINED; states equal (test-plan F3)
- [ ] 4.4 F4 plain-string bash: update `partialResult:"chunk"` + end `result` → fold both → tail dropped; `messages[idx].result` equal (test-plan F4)
- [ ] 4.5 F5 structured tail + end without details: tail `details:{k:1}` → fold both → tail RETAINED; `toolDetails` equal (test-plan F5)
- [ ] 4.6 F6 truthy-empty tail: tail `details:{}` + end without `details` → fold both → tail RETAINED; folded `toolDetails` does NOT contain the creating tick's keys (test-plan F6)
- [ ] 4.7 F7 mirror: extend the file's local `selectRetained` mirror AND its store cross-check to the end-side gate → run F1–F6 → cross-check passes (test-plan F7)
- [ ] 4.8 Run the full suite per AGENTS.md (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`) and verify 0 failed

## 5. Docs + closeout

- [ ] 5.1 Update the `memory-event-store.ts` row/sidecar in `packages/server/src/persistence/AGENTS.md` (or `memory-event-store.ts.AGENTS.md`) with the end-triggered drop, the end-side resolver + presence/identity rules, the resident-pin guard, and `See change: drop-final-update-on-tool-execution-end`; verify `kb agents packages/server/src/persistence/memory-event-store.ts` shows it
- [ ] 5.2 Delegate a caveman-style note to DocScribe for the retention section of `docs/architecture.md` (one paragraph: end-triggered drop, same predicates with end-side resolution, `activity`-cleared case retains, measured drop rate from `verification.md`); verify the paragraph is present
- [ ] 5.3 Restart the server (`curl -X POST http://localhost:8000/api/restart`), spawn one Agent, and verify `GET /api/health` `storeTrim.collapsedUpdates` increments after the Agent's `tool_execution_end` when its end subsumed the tail (or stays flat with the retaining key named, matching 1.3) (test-plan X3, manual-only)
