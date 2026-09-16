# Test Plan — heal-orphaned-tool-cards-on-session-end

Stage: design   Generated: 2026-09-15

No clarification markers: every Triple slot resolved from the spec deltas +
design decisions (thresholds come from design D2 Risks and task 4b.1 baselines).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 open-call derivation | state-transition (legal edge) | L1 | automated | stored events `agent_start`, `start{A,"Agent"}`, `update{A}` with `data.partialResult.details.agentId="ag-1"`, `start{B,"bash"}`, no ends | `findOpenToolCalls(events)` | returns exactly `[{toolCallId:"A",toolName:"Agent",agentId:"ag-1"},{toolCallId:"B",toolName:"bash"}]` |
| E2 | R1 agentId path | EP (valid/invalid partition) | L1 | automated | an `update` fixture **copied verbatim from a recorded transcript** (nested `data.partialResult.details.agentId`) vs one with a flat `data.details.agentId` | `findOpenToolCalls` | nested form yields `agentId:"ag-1"`; flat form yields `agentId: undefined` (proves the reader is not matching the wrong shape) |
| E3 | R1 turn scoping | BVA (boundary = last `agent_start`) | L1 | automated | `start{C}` (no end) BEFORE the last `agent_start`, `start{D}` (no end) after it | `findOpenToolCalls` | returns `[D]` only; `C` absent |
| E4 | R1 closed calls | EP (invalid partition) | L1 | automated | every `start` has a matching `end` | `findOpenToolCalls` | returns `[]` |
| E5 | R1 empty / no `agent_start` | BVA (min) | L1 | automated | `[]`, and a stream with starts but no `agent_start` at all | `findOpenToolCalls` | `[]` for empty; whole stream treated as one turn for the second |
| E6 | R2 subagent derivation | decision-table (created × started × terminal) | L1 | automated | `created{ag-9}`+`started{ag-9}` no terminal; `started{ag-1}`+`completed{ag-1}`; `created{ag-7}` only | `findOpenSubagents(events)` | returns `["ag-9","ag-7"]`; `ag-1` absent |
| E7 | R1 idempotence | state-transition (repeat event) | L1 | automated | a stream that already contains `end{A,healedBy:"session_ended"}` | second `findOpenToolCalls` pass | returns `[]` — the derivation is its own idempotence guard |
| E8 | R6 migration decision table | decision-table (value × marker) | L1 | automated | config `{0, no marker}`, `{0, marker}`, `{250, no marker}`, `{absent}` | boot migration runs | → `500`+marker written · `0` kept, file untouched · `250` kept · `500` resolved from default |
| E9 | R6 key preservation | EP | L1 | automated | config carrying keys outside the `ensureConfig()` 11-key seed set | boot migration rewrites the throttle | every unrelated key still present byte-for-byte after the write |
| E10 | R6 fresh install | state-transition (init edge) | L1 | automated | no `config.json` | `ensureConfig()` creates it, then the user writes `0`, then the server boots again | file contains the marker at creation; the user's `0` survives the second boot |
| E11 | R7 npm-root memo | EP + call-counting | L1 | automated | `vi.spyOn(npm,"rootGlobalOr")`; 3× `resolvePiPackageEntry` + 1× `listPiPackages`, no `npmRoot` | the four calls run | spy called exactly once |
| E12 | R7 override + reset | decision-table (opts × cache state) | L1 | automated | `{npmRoot:"/tmp/x"}`; then `resetNpmRootCacheForTests()` then a default call | each call runs | override → spy never called and `/tmp/x` used; after reset → spy called again |
| E13 | R7 empty result cached | BVA (degenerate value) | L1 | automated | `rootGlobalOr` stubbed to return `""` | two default resolves | spy called once; both resolves return the same (null/unresolved) result |
| E14 | R8 no result caching | EP (invalidation) | L1 | automated | resolve spec `X` (miss), then add `X` to `~/.pi/agent/settings.json#packages[]` (tmp agentDir) | resolve `X` again in the same process | second call resolves `X` — settings reads are not cached |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R1 scan bound (design D2) | threshold on worst case | L1 | automated | a synthetic stored stream at the store cap (20 000 events) with no `agent_start` | `findOpenToolCalls` wall time < 10 ms (the number that decides whether a limit is needed at all) | single call, median of 5 |
| P2 | R7 spawn cost (design D6) | before/after A-B | L2 | automated | `node spike/perchild-cost-spike.mjs <cwd> wrapper 7` (7 concurrent child loaders, warm parent) | `maxLoopLagMs` < 300 ms (baseline 3 300 ms) | one run |
| P3 | R5 tick cadence | throughput threshold | L2 | automated | a live `Agent` run under the flipped default | bridge metrics `tickCoalesced > 0` and forwarded ticks ≤ 4/s per child | one 30 s subagent run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R4 tool-card heal | state-transition (legal edge) | L1 | automated | reducer state: tool call `A` `running`, subagent `ag-1` `running` | reduce `end{A,"Agent",isError:true,result:"parent session ended",healedBy:"session_ended",details:{agentId:"ag-1"}}` | `A.status === "error"`; `ag-1.status === "failed"` with `error === "parent session ended"` |
| F2 | R4 terminal not clobbered (tool) | state-transition (illegal edge) | L1 | automated | tool call `A` already `complete` | same synthesized end reduces | state unchanged (deep-equal to the pre-state) |
| F3 | R4 terminal not clobbered (subagent) | state-transition (illegal edge) | L1 | automated | subagent `ag-1` already `completed`, tool call `A` `running` | synthesized end with `details.agentId:"ag-1"`, then a synthesized `subagent_failed{ag-1}` | `ag-1` stays `completed` in both cases; `A` becomes `error` |
| F4 | R4 real end still wins | state-transition (ordering) | L1 | automated | a `superseded` placeholder row | a real `tool_execution_end` (no `healedBy`) reduces | row takes the real result and the heal marker is cleared (existing behaviour, regression guard) |
| F5 | R4 unknown id | EP (invalid partition) | L1 | automated | reducer state with no `toolCalls` entry for `Z` | synthesized end for `Z` reduces | state unchanged, no phantom card created |
| F6 | R1+R4 end-to-end live | state-convergence | L3 | automated | a dashboard-attached session running an `Agent` call | the pi process is killed out of band; grace expires | the `Agent` tool card converges to error state showing `parent session ended`, the subagent card to failed, and the session to `ended` — asserted against the harness-derived `dashboardPort` |
| F7 | R3 replay agreement | state-convergence after reload | L3 | automated | the session healed in F6, with the server restarted so the store lost it | reopen the session in the browser (cold hydration from transcript) | the tool card is STILL an error card with `parent session ended` — not a silent empty success |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R1 both end seams | fault-injection (process death vs status set) | L1 | automated | a session with 2 open calls (one `Agent`) + 1 non-terminal subagent | (a) `sessionManager.unregister(id)`; (b) `sessionManager.update(id,{status:"ended"})` with no unregister | both paths insert + broadcast the same 3 synthesized events, ordered BEFORE `session_updated{status:"ended"}` |
| X2 | R1 no-op | fault-injection (empty state) | L1 | automated | a session with nothing open | the session ends | zero `insertEvent`, zero `broadcastEvent`; only the existing `session_updated` |
| X3 | R1 repeated hook | fault-injection (duplicate signal) | L1 | automated | a session already healed | `onEnded` fires again (later `closedReason` change) | no further insert — exactly 3 synthesized events exist in total |
| X4 | R1 relocation is not a death | fault-injection (look-alike signal) | L1 | automated | a session with 1 open tool call | `session_moved` → `update({movedTo, status:"ended"})` | zero synthesized events — the gate reads `session.movedTo`, not `closedReason` |
| X5 | R1 replay suppression | fault-injection (concurrent replay) | L1 | automated | `replayingSessions` contains the session id | the session ends with 1 open call | the event is inserted but NOT broadcast |
| X6 | R3 orphaned transcript | fault-injection (truncated input) | L1 | automated | transcript entries whose last turn has a `toolCall` with no `toolResult` | `replayEntriesAsEvents(entries)` | emits `tool_execution_end{isError:true, result:"parent session ended", healedBy:"session_ended"}`; the entry list is not mutated |
| X7 | R3 complete transcript | fault-injection (control) | L1 | automated | a transcript where every `toolCall` has its `toolResult` | `replayEntriesAsEvents` | no orphan-close event emitted (regression guard on the existing suite) |
| X8 | R6 no bridge writes | fault-injection (wrong caller) | L1 | automated | a writable `config.json` with `{0, no marker}` | `loadConfig()` called (the bridge's path), server boot NOT run | file mtime + bytes unchanged — migration never runs from a read path |

---

## Coverage summary

- Requirements covered: 8/8 (R1 open-call heal · R2 subagent heal · R3 transcript orphan-close · R4 reducer guards · R5 throttle default · R6 migration · R7 npm-root memo · R8 memo scoping)
- Scenarios by class: edge 14 · perf 3 · frontend 7 · error 8
- Scenarios by level: L1 28 · L2 2 · L3 2
- Scenarios by disposition: automated 32 · manual-only 0

## New infra needed

- none. L1 extends existing vitest suites, L2 reuses the spike scripts carried in
  the upstream change's `spike/`, L3 extends `tests/e2e/` against the docker
  harness (port read from `.pi-test-harness.json`, never hardcoded).
