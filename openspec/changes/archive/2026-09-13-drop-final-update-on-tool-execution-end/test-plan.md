# Test Plan — drop-final-update-on-tool-execution-end

Stage: apply   Generated: 2026-08-12

Requirement refs: **R1** = spec "retained tail dropped on `tool_execution_end` ONLY when the end subsumes it" (scenario 1 drop / scenario 2 retain / scenario 3 cross-version); design D2 (gate + presence rule + identity rule), D3 (hook, resident pin, `newestSeq = creatingSeq`), D4 (end never a candidate), D5 (replay equivalence).

All L1 rows live in `packages/server/src/__tests__/` — gate rows (E*) in `memory-event-store.test.ts` next to the existing `subsumes` tests X1–X9; store rows (S*) in the same file's `collapse of superseded tool_execution_update events` describe; replay rows (F*) in `collapse-replay-equivalence.test.ts`.

---

## Scenarios

### Edge-case — end-side gate (pure predicate, design D2)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 s1, D2 | EP nominal | L1 | automated | tail `partialResult.details = {agentId:"a1", status:"running", tokensUsage:{...}, activity:"x"}`, `content` set; end `data.details` same keys + same types, `toolName:"Agent"`, `agentId:"a1"`, `result:"done"` | end-side gate called | returns `true` |
| E2 | R1 s2, D2 | EP (key missing) | L1 | automated | tail has `activity:"writing"`; end `details` lacks `activity`, otherwise E1 | gate called | returns `false` |
| E3 | R1 s2, D2 | EP (type differs) | L1 | automated | tail `tokensUsage:{...}` (object); end `tokensUsage: 42` (number), otherwise E1 | gate called | returns `false` |
| E4 | R1 s2, D2 | decision-table (result implication) | L1 | automated | tail `partialResult.content` yields text; end `result: ""` (falsy), details ⊇ tail | gate called | returns `false` |
| E5 | D2 (non-Agent) | EP (plain-string) | L1 | automated | tail `partialResult: "chunk"` (no `details`); end no `details`, `result:"out"` | gate called | returns `true` |
| E6 | D2 presence rule | BVA (details truthy vs absent) | L1 | automated | tail `details: {agentId:"a1"}`; end no `details`, `result:"out"` | gate called | returns `false` |
| E7 | D2 presence rule | BVA (truthy-EMPTY) | L1 | automated | tail `details: {}`; end no `details`, `result:"out"` | gate called | returns `false` |
| E8 | D2 presence rule | BVA (truthy non-object) | L1 | automated | tail `details: "text"`; end no `details`, `result:"out"` | gate called | returns `false` |
| E9 | D2 resolver | EP (invalid end details) | L1 | automated | tail as E1; end `details: null` — and separately `details: []` — `result:"done"` | gate called | returns `false` both (treated as absent ⇒ presence rule) |
| E10 | D2 identity rule | decision-table | L1 | automated | tail `agentId:"a1"`; end `details` ⊇ tail but (a) `toolName` absent, (b) `toolName:"bash"`, (c) `agentId:"a2"` | gate called ×3 | returns `false` ×3 |
| E11 | D2 identity rule | decision-table | L1 | automated | tail `agentId:"a1", agentSessionId:"s1"`; end `agentSessionId:"s2"`, otherwise E1 | gate called | returns `false` |
| E12 | D2 identity rule | decision-table (absent-then-present) | L1 | automated | tail `agentId:"a1"` no `agentSessionId`; end adds `agentSessionId:"s1"`, otherwise E1 | gate called | returns `true` |
| E13 | D2 entries | BVA | L1 | automated | tail `entries:[e1]`; end `entries:[]`, otherwise E1 | gate called | returns `false` |
| E14 | D2 regression | EP (update successor unchanged) | L1 | automated | existing X1–X9 fixtures | `npx vitest run packages/server/src/__tests__/memory-event-store.test.ts` after the `subsumes` refactor | X1–X9 pass with zero fixture edits |

### Edge-case — store hook (design D3/D4)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | R1 s1 | state-transition (drop) | L1 | automated | store with `[creating tick(agentId), tail, ]` for `tc1` | insert subsuming end (E1 shape) | tail seq absent from `getEvents`; creating tick + end present; `getTrimStats().collapsedUpdates` +1; index `newestSeq === creatingSeq` |
| S2 | R1 s2 | state-transition (retain) | L1 | automated | same as S1 | insert non-subsuming end (E2 shape) | all three events present; `collapsedUpdates` unchanged |
| S3 | D3 pin guard | BVA (tail IS pin) | L1 | automated | store with `[creating tick]` only | insert subsuming end | nothing dropped; counter unchanged |
| S4 | D3 resident pin | state-transition (pin trimmed) | L1 | automated | `maxEventsPerSession` small enough that a trim evicts the creating tick (`pruneCollapseIndex` releases `creatingSeq`); tail still resident | insert subsuming end | tail RETAINED; counter unchanged |
| S5 | D3 fail-open | EP (no toolCallId) | L1 | automated | store as S1 | insert end with `toolCallId` absent | no throw; nothing dropped |
| S6 | D3 fail-open | EP (unknown call) | L1 | automated | store as S1 | insert subsuming end for `toolCallId:"other"` | no throw; nothing dropped |
| S7 | D3 fail-open | state-transition (tail already trimmed) | L1 | automated | index still points at a `newestSeq` whose event was trimmed | insert subsuming end | no throw; nothing dropped; counter unchanged |
| S8 | D3 post-drop index | state-transition (late update) | L1 | automated | after S1 drop, then trim runs `pruneCollapseIndex` | insert late `tool_execution_update` for `tc1` | index entry survived prune; late update retained; creating tick still present (not re-pinned to the late update) |
| S9 | D3 hook order | state-transition (truncated end) | L1 | automated | end whose serialized size exceeds `maxEventDataSize` and is NOT a subagent timeline (becomes `{__truncated}`) | insert | no drop; no throw |
| S10 | D4 | invariant | L1 | automated | store as S1 | insert TWO subsuming ends for `tc1` | second end never removed; first end never removed; counter +1 total |
| S11 | D3 counter | invariant | L1 | automated | store as S1 | subsuming end, then `GET /api/health`-shaped `getTrimStats()` | `collapsedUpdates` reflects the end-drop (no new counter key present) |

### Frontend-quirk — replay equivalence (design D5; reducer fold, no browser)

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 s1 | state-convergence | L1 | automated | stream `[start, creating tick, tail, end]` Agent completed, end ⊇ tail, `toolName:"Agent"` | fold ORIGINAL vs STORE-RETAINED through client reducer | tail dropped AND `messages[idx].{result,toolDetails,toolStatus}` deep-equal AND `subagents.get(agentId)` + `subagents.get(agentSessionId)` deep-equal |
| F2 | R1 s1 | state-convergence | L1 | automated | Agent failed: end `isError:true`, `details.error:"boom"` (end-only key) | fold both | tail dropped; folded states equal |
| F3 | R1 s2 | state-convergence | L1 | automated | Agent with `activity` cleared on end (tail has `activity`) | fold both | tail RETAINED; folded states equal (trivially) |
| F4 | D2 non-Agent | state-convergence | L1 | automated | plain-string `bash` update + end `result` | fold both | tail dropped; `messages[idx].result` equal |
| F5 | D2 presence | state-convergence | L1 | automated | structured tail `details:{k:1}` + end without `details` | fold both | tail RETAINED; folded `toolDetails` equal |
| F6 | D2 presence (truthy-empty) | state-convergence | L1 | automated | tail `details:{}` + end without `details` | fold both | tail RETAINED; folded `toolDetails` does NOT contain the creating tick's keys |
| F7 | D5 mirror | invariant | L1 | automated | every F1–F6 fixture | file's local `selectRetained` mirror vs real store cross-check | cross-check passes for the end-side gate (mirror extended) |

### Error-handling / process

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R1 s3, D1 | cross-version static diff | — | manual-only | producer versions 0.2.0–0.2.4 differ in `snapshotDetails`/`buildDetails`/`activityFromEvent`/terminal paths | `npm pack` each, diff | `verification.md` has one section per version with items (a)–(d); status line "gate sound" or "tail retained; do not re-propose" [judgment: source reading of an external package — not harness-reproducible] |
| X2 | R1 s3, D1 | live capture | — | manual-only | installed producer wire shape ≠ source read | spawn one Agent on the dev dashboard, dump tail + end for its `toolCallId` | `verification.md` records the gate result by hand + which key blocked (if any) + measured drop rate [judgment: needs the installed producer on a live pi, not the docker harness] |
| X3 | Migration | process | — | manual-only | — | `curl -X POST /api/restart`, spawn Agent | `GET /api/health` `storeTrim.collapsedUpdates` moves (or stays flat with the retaining key named, matching X2) |

---

## Coverage summary

- Requirements covered: 3/3 spec scenarios; D2/D3/D4/D5 each ≥1 row
- Scenarios by class: edge 25 (E1–E14, S1–S11) · perf 0 · frontend 7 · error/process 3
- Scenarios by level: L1 32 · L2 0 · L3 0 · — 3
- Scenarios by disposition: automated 32 · manual-only 3

Performance: none — the hook is one `Map.get` + one `findIndexBySeq` backward scan per end (same cost class as the parent's collapse); no latency budget in spec, none invented.

## New infra needed

- none — all rows extend existing vitest files (`memory-event-store.test.ts`, `collapse-replay-equivalence.test.ts`).
